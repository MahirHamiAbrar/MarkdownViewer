use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::anthropic;
use crate::fsutil;
use crate::providers::{self, Provider, ANTHROPIC};

const MAX_REASONING_CHARS: usize = 100_000;
const MAX_MEMORY_BYTES: usize = 256_000;
const MAX_TOOLS: usize = 16;
const MAX_OUTPUT_TOKENS: u64 = 8192;

pub struct AiState {
    pub(crate) client: reqwest::Client,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for AiState {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(600))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            cancels: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiAction {
    pub id: String,
    pub name: String,
    pub detail: String,
    pub status: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
    /// Cost in USD, only when the provider reports one.
    pub cost: Option<f64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiTiming {
    pub first_token_ms: u64,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolCall {
    pub id: String,
    pub name: String,
    /// JSON text exactly as the model wrote it; the webview parses and runs it.
    pub arguments: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiReply {
    pub content: String,
    pub reasoning: String,
    pub actions: Vec<AiAction>,
    pub tool_calls: Vec<AiToolCall>,
    /// The assistant turn in the provider's own shape, when a tool round has to hand it
    /// back unchanged (Anthropic thinking blocks carry a signature). Opaque to the webview.
    pub provider_blocks: Option<Value>,
    pub stopped: bool,
    pub usage: AiUsage,
    pub timing: AiTiming,
}

/// Streamed to the webview through a Tauri channel.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiEvent {
    Status { phase: String },
    ReasoningDelta { text: String },
    Delta { text: String },
    Action { id: String, name: String, detail: String, status: String },
    Done {
        input_tokens: u64,
        output_tokens: u64,
        reasoning_tokens: u64,
        cost: Option<f64>,
        first_token_ms: u64,
        duration_ms: u64,
    },
}

/// What Mark knows about the user: `{ "profile": "...", "items": [{ id, text, createdAt }] }`.
/// ponytail: one small JSON file, rewritten whole. Move to SQLite if memory ever needs search or grows past a few hundred facts.
#[tauri::command(async)]
pub fn memory_load(app: AppHandle) -> String {
    fsutil::app_dir(&app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("memory.json")).ok())
        .unwrap_or_else(|| "{}".into())
}

#[tauri::command(async)]
pub fn memory_save(app: AppHandle, json: String) -> Result<(), String> {
    if json.len() > MAX_MEMORY_BYTES {
        return Err("Memory is too large.".into());
    }
    let value: Value = serde_json::from_str(&json).map_err(|e| format!("Invalid memory JSON: {e}"))?;
    if !value.is_object() {
        return Err("Invalid memory JSON: expected an object.".into());
    }
    let dir = fsutil::ensure_app_dir(&app)?;
    fsutil::atomic_write(&dir.join("memory.json"), json.as_bytes(), true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) {
    if let Some(flag) = state.cancels.lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// A validated provider + model + key, ready to build a request for.
struct Route {
    provider: Provider,
    model: providers::Model,
    key: Option<String>,
}

impl Route {
    fn resolve(app: &AppHandle, provider: &str, model: &str) -> Result<Self, String> {
        let dir = fsutil::app_dir(app)?;
        let provider = providers::find(&dir, provider)?;
        let model = provider
            .model(model)
            .cloned()
            .ok_or_else(|| format!("{} has no model “{model}”. Pick another model.", provider.display_name()))?;
        let key = providers::resolve_key(&dir, &provider).map(|(key, _)| key);
        if key.is_none() && !provider.no_key {
            return Err(format!("No {} API key is configured. Add one in Settings.", provider.display_name()));
        }
        Ok(Self { provider, model, key })
    }

    fn name(&self) -> &str {
        self.provider.display_name()
    }

    /// The wire spelling of an effort level; `Err` for a level this model does not offer.
    fn effort(&self, level: &str) -> Result<Option<Effort>, String> {
        let Some(efforts) = self.provider.efforts(&self.model) else {
            return Ok(None); // no Effort menu: send nothing
        };
        let level = if level.is_empty() { self.provider.reasoning.as_deref().unwrap_or("") } else { level };
        match efforts.get_key_value(level) {
            Some((level, wire)) => Ok(Some(Effort { level: level.clone(), wire: wire.clone() })),
            None => Err("Unsupported reasoning effort for this model.".into()),
        }
    }

    fn cheapest_effort(&self) -> Option<Effort> {
        let efforts = self.provider.efforts(&self.model)?;
        let level = providers::cheapest_effort(efforts)?;
        Some(Effort { level: level.to_string(), wire: efforts[level].clone() })
    }

    fn max_tokens(&self) -> u64 {
        // Anthropic counts thinking against the same budget, so it gets more room.
        let limit = if self.provider.api == ANTHROPIC { 32_000 } else { MAX_OUTPUT_TOKENS };
        self.model.max_tokens.map_or(limit, |cap| cap.min(limit))
    }

    fn post(&self, client: &reqwest::Client, body: &Value) -> reqwest::RequestBuilder {
        let path = if self.provider.api == ANTHROPIC { "v1/messages" } else { "chat/completions" };
        providers::authorize(&self.provider, self.key.as_deref(), client.post(self.provider.url(path))).json(body)
    }

    /// The request body for either protocol. `messages` and `tools` arrive in the
    /// chat-completions shape the webview builds.
    fn body(&self, messages: Vec<Value>, tools: Vec<Value>, tool_choice: &str, effort: Option<&Effort>, max_tokens: u64, stream: bool) -> Result<Value, String> {
        if self.provider.api == ANTHROPIC {
            return anthropic::body(&self.model.id, messages, tools, tool_choice, effort.and_then(|e| e.wire.as_deref()), max_tokens, stream);
        }
        let compat = &self.provider.compat;
        let messages: Vec<Value> = messages.into_iter().map(strip_provider_blocks).collect();
        let mut body = json!({ "model": self.model.id, "messages": messages, "stream": stream });
        body[compat.max_tokens_field.as_deref().unwrap_or("max_tokens")] = json!(max_tokens);
        if stream {
            body["stream_options"] = json!({ "include_usage": true });
        }
        if let Some(effort) = effort {
            if compat.thinking_format.as_deref() == Some("deepseek") {
                body["thinking"] = json!({ "type": if effort.level == "off" { "disabled" } else { "enabled" } });
            }
            if let Some(wire) = &effort.wire {
                if compat.reasoning_format.as_deref() == Some("openrouter") {
                    body["reasoning"] = json!({ "effort": wire });
                } else {
                    body["reasoning_effort"] = json!(wire);
                }
            }
        }
        if !tools.is_empty() {
            if compat.tool_choice != Some(false) {
                body["tools"] = Value::Array(tools);
                body["tool_choice"] = json!(tool_choice);
            } else if tool_choice != "none" {
                body["tools"] = Value::Array(tools);
            }
        }
        Ok(body)
    }
}

pub(crate) struct Effort {
    level: String,
    wire: Option<String>,
}

fn strip_provider_blocks(mut message: Value) -> Value {
    if let Some(object) = message.as_object_mut() {
        object.remove("provider_blocks");
    }
    message
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // one argument per field of the webview call
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AiState>,
    request_id: String,
    provider: String,
    model: String,
    effort: String,
    messages: Vec<Value>,
    tools: Option<Vec<Value>>,
    tool_choice: Option<String>,
    on_event: Channel<AiEvent>,
) -> Result<AiReply, String> {
    let tools = tools.unwrap_or_default();
    if tools.len() > MAX_TOOLS {
        return Err("Too many tools.".into());
    }
    let tool_choice = tool_choice.unwrap_or_else(|| "auto".into());
    if !["auto", "none"].contains(&tool_choice.as_str()) {
        return Err("Unsupported tool choice.".into());
    }
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("Invalid request id.".into());
    }
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }
    let route = Route::resolve(&app, &provider, &model)?;
    let effort = route.effort(&effort)?;
    let body = route.body(messages, tools, &tool_choice, effort.as_ref(), route.max_tokens(), true)?;

    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let request = route.post(&state.client, &body);
    let result = if route.provider.api == ANTHROPIC {
        stream_chat(request, anthropic::Parser::default(), route.name(), &cancel, &on_event).await
    } else {
        stream_chat(request, OpenAiParser::default(), route.name(), &cancel, &on_event).await
    };
    state.cancels.lock().unwrap().remove(&request_id);
    result
}

/// One provider's server-sent events, turned into the items the chat loop understands.
pub(crate) trait Protocol: Default {
    fn payload(&mut self, payload: &str, out: &mut Vec<StreamItem>);
    fn tool_calls(&self) -> Vec<AiToolCall>;
    /// Called once the stream ends: an error the stream itself reported, or the turn to hand back.
    fn finish(&mut self, _content: &str) -> Result<Option<Value>, String> {
        Ok(None)
    }
}

async fn stream_chat<P: Protocol>(
    request: reqwest::RequestBuilder,
    protocol: P,
    name: &str,
    cancel: &AtomicBool,
    on_event: &Channel<AiEvent>,
) -> Result<AiReply, String> {
    let started = Instant::now();
    let response = request.send().await.map_err(|e| network_error(&e, name))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(http_error(status.as_u16(), &body, name));
    }
    // Some gateways report the request cost on a header; keep it as a fallback.
    let header_cost = response.headers().iter().find_map(|(name, value)| {
        if !name.as_str().to_ascii_lowercase().contains("cost") {
            return None;
        }
        value.to_str().ok().and_then(parse_cost)
    });

    let mut reply = AiReply::default();
    let mut usage = AiUsage::default();
    let mut parser = SseParser { buf: Vec::new(), protocol };
    let mut first_token_ms = 0u64;
    let mut phase = String::new();

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            reply.stopped = true;
            break;
        }
        let chunk = chunk.map_err(|e| network_error(&e, name))?;
        for item in parser.feed(&chunk) {
            apply_stream_item(item, &mut reply, &mut usage, &mut first_token_ms, &mut phase, started, header_cost, on_event);
        }
    }
    // A stream may end right after its last event without a trailing newline.
    for item in parser.finish() {
        apply_stream_item(item, &mut reply, &mut usage, &mut first_token_ms, &mut phase, started, header_cost, on_event);
    }

    if usage.cost.is_none() {
        usage.cost = header_cost;
    }
    reply.usage = usage.clone();
    reply.timing = AiTiming {
        first_token_ms,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    for action in &mut reply.actions {
        action.status = "done".into();
    }
    // A stopped stream may hold half-written arguments; never hand those out to be run.
    if !reply.stopped {
        reply.provider_blocks = parser.protocol.finish(&reply.content).map_err(|e| format!("{name}: {e}"))?;
        reply.tool_calls = parser.protocol.tool_calls();
    }
    let _ = on_event.send(AiEvent::Done {
        input_tokens: usage.input,
        output_tokens: usage.output,
        reasoning_tokens: usage.reasoning,
        cost: usage.cost,
        first_token_ms: reply.timing.first_token_ms,
        duration_ms: reply.timing.duration_ms,
    });
    Ok(reply)
}

#[allow(clippy::too_many_arguments)]
fn apply_stream_item(
    item: StreamItem,
    reply: &mut AiReply,
    usage: &mut AiUsage,
    first_token_ms: &mut u64,
    phase: &mut String,
    started: Instant,
    header_cost: Option<f64>,
    on_event: &Channel<AiEvent>,
) {
    match item {
        StreamItem::Reasoning(text) => {
            if *first_token_ms == 0 {
                *first_token_ms = started.elapsed().as_millis() as u64;
            }
            if phase.as_str() != "thinking" {
                *phase = "thinking".into();
                let _ = on_event.send(AiEvent::Status { phase: "thinking".into() });
            }
            push_capped(&mut reply.reasoning, &text, MAX_REASONING_CHARS);
            let _ = on_event.send(AiEvent::ReasoningDelta { text });
        }
        StreamItem::Content(text) => {
            if *first_token_ms == 0 {
                *first_token_ms = started.elapsed().as_millis() as u64;
            }
            if phase.as_str() != "writing" {
                *phase = "writing".into();
                let _ = on_event.send(AiEvent::Status { phase: "writing".into() });
            }
            reply.content.push_str(&text);
            let _ = on_event.send(AiEvent::Delta { text });
        }
        StreamItem::Action { id, name, detail } => {
            let action = AiAction { id: id.clone(), name: name.clone(), detail: detail.clone(), status: "running".into() };
            if let Some(existing) = reply.actions.iter_mut().find(|action| action.id == id) {
                *existing = action;
            } else {
                reply.actions.push(action);
            }
            let _ = on_event.send(AiEvent::Action { id, name, detail, status: "running".into() });
        }
        StreamItem::Usage { input, output, reasoning, cost } => {
            *usage = AiUsage { input, output, reasoning, cost: cost.or(header_cost) };
        }
        StreamItem::Done => {}
    }
}

#[tauri::command]
/// One short non-streamed completion: chat titles and conversation summaries.
pub async fn ai_complete(
    app: AppHandle,
    state: State<'_, AiState>,
    provider: String,
    model: String,
    messages: Vec<Value>,
    max_tokens: u32,
) -> Result<String, String> {
    let route = Route::resolve(&app, &provider, &model)?;
    let effort = route.cheapest_effort();
    let mut max_tokens = u64::from(max_tokens.clamp(1, 1200));
    // Thinking that cannot be switched off shares the output budget; leave it room.
    if effort.as_ref().is_some_and(|effort| effort.level != "off") {
        max_tokens += 4000;
    }
    let body = route.body(messages, Vec::new(), "none", effort.as_ref(), max_tokens, false)?;
    let response = route.post(&state.client, &body).send().await.map_err(|e| network_error(&e, route.name()))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(http_error(status.as_u16(), &text, route.name()));
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let text = if route.provider.api == ANTHROPIC {
        anthropic::reply_text(&value)
    } else {
        value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    if text.is_empty() {
        return Err(format!("{} returned an empty reply.", route.name()));
    }
    Ok(text)
}

fn push_capped(target: &mut String, text: &str, cap: usize) {
    if target.len() >= cap {
        return;
    }
    let room = cap - target.len();
    if text.len() <= room {
        target.push_str(text);
        return;
    }
    let mut end = room;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&text[..end]);
}

pub(crate) fn http_error(status: u16, body: &str, name: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message").and_then(Value::as_str).or_else(|| error.as_str()))
                .map(str::to_owned)
        })
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| body.chars().take(240).collect::<String>().trim().to_string());
    let hint = match status {
        401 => format!("Your {name} API key was rejected. Check it in Settings."),
        429 => format!("{name} is rate-limiting requests right now. Try again in a moment."),
        502..=504 | 529 => format!("{name} is temporarily unavailable. Try again shortly."),
        _ => String::new(),
    };
    match (hint.is_empty(), message.is_empty()) {
        (false, _) => format!("{hint} ({status})"),
        (true, false) => format!("{name} error ({status}): {message}"),
        (true, true) => format!("{name} error ({status})."),
    }
}

pub(crate) fn network_error(error: &reqwest::Error, name: &str) -> String {
    if error.is_timeout() {
        format!("{name} took too long to respond. Check your connection and try again.")
    } else if error.is_connect() {
        format!("Couldn't connect to {name}. Check that it is running and reachable.")
    } else {
        format!("Couldn't reach {name}. Check your connection and try again.")
    }
}

fn parse_cost(value: &str) -> Option<f64> {
    value
        .split(|c: char| c.is_whitespace() || c == '$' || c == '=' || c == ':')
        .filter(|part| !part.is_empty())
        .find_map(|part| part.trim_matches('"').parse::<f64>().ok())
        .filter(|cost| cost.is_finite() && *cost >= 0.0)
}

fn value_cost(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(parse_cost))
}

/// Cost is not part of the OpenAI schema; accept the field names gateways commonly use.
fn usage_cost(usage: &Value, root: &Value) -> Option<f64> {
    for key in ["cost", "total_cost", "cost_usd", "total_cost_usd", "totalCost", "costUsd"] {
        if let Some(cost) = usage.get(key).and_then(value_cost) {
            return Some(cost);
        }
    }
    if let Some(cost) = usage
        .get("cost")
        .and_then(|cost| cost.get("total").or_else(|| cost.get("usd")).or_else(|| cost.get("amount")))
        .and_then(value_cost)
    {
        return Some(cost);
    }
    ["cost", "total_cost", "cost_usd", "total_cost_usd"]
        .iter()
        .find_map(|key| root.get(*key).and_then(value_cost))
}

#[derive(Debug, PartialEq)]
pub(crate) enum StreamItem {
    Content(String),
    Reasoning(String),
    Action { id: String, name: String, detail: String },
    Usage { input: u64, output: u64, reasoning: u64, cost: Option<f64> },
    Done,
}

#[derive(Default)]
struct ToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn tool_id(index: usize, call: &ToolCall) -> String {
    if call.id.is_empty() { format!("tool-{index}") } else { call.id.clone() }
}

/// Splits a byte stream into `data:` payloads and hands each to the protocol.
#[derive(Default)]
pub(crate) struct SseParser<P: Protocol> {
    buf: Vec<u8>,
    pub(crate) protocol: P,
}

impl<P: Protocol> SseParser<P> {
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<StreamItem> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(at) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=at).collect();
            let line = String::from_utf8_lossy(&line);
            if let Some(payload) = line.trim_end().strip_prefix("data:") {
                self.protocol.payload(payload.trim(), &mut out);
            }
        }
        out
    }

    /// Flush a final line that arrived without its trailing newline.
    pub(crate) fn finish(&mut self) -> Vec<StreamItem> {
        let mut out = Vec::new();
        if self.buf.is_empty() {
            return out;
        }
        let line: Vec<u8> = std::mem::take(&mut self.buf);
        let line = String::from_utf8_lossy(&line);
        if let Some(payload) = line.trim_end().strip_prefix("data:") {
            self.protocol.payload(payload.trim(), &mut out);
        }
        out
    }
}

/// Chat-completions streaming (`openai-completions`).
#[derive(Default)]
struct OpenAiParser {
    tools: HashMap<usize, ToolCall>,
}

impl Protocol for OpenAiParser {
    fn tool_calls(&self) -> Vec<AiToolCall> {
        let mut indexes: Vec<_> = self.tools.keys().copied().collect();
        indexes.sort_unstable();
        indexes
            .into_iter()
            .map(|index| (index, &self.tools[&index]))
            .filter(|(_, call)| !call.name.is_empty())
            .map(|(index, call)| AiToolCall {
                id: tool_id(index, call),
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            })
            .collect()
    }

    fn payload(&mut self, payload: &str, out: &mut Vec<StreamItem>) {
        if payload == "[DONE]" {
            out.push(StreamItem::Done);
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            return;
        };

        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            let input = usage.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0);
            let output = usage.get("completion_tokens").and_then(Value::as_u64).unwrap_or(0);
            let reasoning = usage
                .get("completion_tokens_details")
                .and_then(|details| details.get("reasoning_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let cost = usage_cost(usage, &value);
            if input > 0 || output > 0 || reasoning > 0 || cost.is_some() {
                out.push(StreamItem::Usage { input, output, reasoning, cost });
            }
        }

        let Some(delta) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"))
        else {
            return;
        };

        if let Some(text) = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            out.push(StreamItem::Reasoning(text.to_string()));
        }
        if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()) {
            out.push(StreamItem::Content(text.to_string()));
        }

        let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) else {
            return;
        };
        for (position, call) in calls.iter().enumerate() {
            let index = call.get("index").and_then(Value::as_u64).map(|i| i as usize).unwrap_or(position);
            let entry = self.tools.entry(index).or_default();
            if let Some(id) = call.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()) {
                entry.id = id.to_string();
            }
            if let Some(name) = call.get("function").and_then(|f| f.get("name")).and_then(Value::as_str) {
                entry.name.push_str(name);
            }
            if let Some(arguments) = call.get("function").and_then(|f| f.get("arguments")).and_then(Value::as_str) {
                entry.arguments.push_str(arguments);
            }
            if !entry.name.is_empty() {
                out.push(StreamItem::Action {
                    id: tool_id(index, entry),
                    name: entry.name.clone(),
                    detail: entry.arguments.clone(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reasoning_content_across_chunks() {
        let mut parser = SseParser::<OpenAiParser>::default();
        assert!(parser.feed(br#"data: {"choices":[{"delta":{"reasoni"#).is_empty());
        let items = parser.feed(b"ng_content\":\"think\"}}]}\n\n");
        assert_eq!(items, vec![StreamItem::Reasoning("think".into())]);

        let items = parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n");
        assert_eq!(items, vec![StreamItem::Content("hi".into()), StreamItem::Done]);
    }

    #[test]
    fn parses_usage_and_tool_calls() {
        let mut parser = SseParser::<OpenAiParser>::default();
        let mut items = parser.feed(
            br#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":"query"}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" more"}}]}}]}
data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"completion_tokens_details":{"reasoning_tokens":2},"cost":0.00042}}
data: [DONE]"#,
        );
        items.extend(parser.finish());
        let actions: Vec<_> = items
            .iter()
            .filter_map(|item| match item {
                StreamItem::Action { name, detail, .. } => Some((name.as_str(), detail.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(actions, [("search", "query"), ("search", "query more")]);
        let usage = items.iter().find_map(|item| match item {
            StreamItem::Usage { input, output, reasoning, cost } => Some((*input, *output, *reasoning, *cost)),
            _ => None,
        });
        assert_eq!(usage, Some((10, 4, 2, Some(0.00042))));
        let calls = parser.protocol.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!((calls[0].id.as_str(), calls[0].name.as_str(), calls[0].arguments.as_str()), ("call_1", "search", "query more"));
        assert!(items.contains(&StreamItem::Done));
    }

    #[test]
    fn parses_cost_variants_without_choices() {
        let mut parser = SseParser::<OpenAiParser>::default();
        let items = parser.feed(
            b"data: {\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_cost\":\"$0.0012\"}}\n",
        );
        assert_eq!(items, vec![StreamItem::Usage { input: 1, output: 2, reasoning: 0, cost: Some(0.0012) }]);
        assert_eq!(parse_cost("$0.50"), Some(0.5));
        assert_eq!(parse_cost("nope"), None);
    }

    fn test_route(id: &str, model: providers::Model) -> Route {
        let dir = std::env::temp_dir().join(format!("mdeditor-route-{}", std::process::id()));
        let mut provider = providers::find(&dir, id).unwrap();
        provider.models = vec![model.clone()];
        Route { provider, model, key: None }
    }

    #[test]
    fn builds_bodies_per_provider() {
        let model = |id: &str| providers::Model { id: id.into(), ..Default::default() };
        let messages = || vec![json!({ "role": "user", "content": "hi", "provider_blocks": [] })];
        let tools = || vec![json!({ "type": "function", "function": { "name": "t", "parameters": {} } })];

        let deepseek = test_route("deepseek", model("deepseek-flash"));
        let off = deepseek.effort("off").unwrap();
        let body = deepseek.body(messages(), tools(), "auto", off.as_ref(), 100, true).unwrap();
        assert_eq!(body["thinking"]["type"], "disabled");
        assert!(body.get("reasoning_effort").is_none());
        assert!(body["messages"][0].get("provider_blocks").is_none());
        assert_eq!((&body["max_tokens"], &body["tool_choice"]), (&json!(100), &json!("auto")));
        let high = deepseek.effort("").unwrap(); // the route's default
        let body = deepseek.body(messages(), vec![], "auto", high.as_ref(), 100, false).unwrap();
        assert_eq!((&body["thinking"]["type"], &body["reasoning_effort"]), (&json!("enabled"), &json!("high")));
        assert!(body.get("stream_options").is_none() && body.get("tools").is_none());
        assert!(deepseek.effort("xhigh").is_err());

        let openai = test_route("openai", model("gpt-x"));
        let auto = openai.effort("auto").unwrap();
        let body = openai.body(messages(), vec![], "auto", auto.as_ref(), 100, true).unwrap();
        assert!(body.get("reasoning_effort").is_none() && body.get("max_tokens").is_none());
        assert_eq!(body["max_completion_tokens"], 100);

        let openrouter = test_route("openrouter", model("x/y"));
        let low = openrouter.effort("low").unwrap();
        assert_eq!(openrouter.body(messages(), vec![], "auto", low.as_ref(), 1, true).unwrap()["reasoning"]["effort"], "low");

        // Ollama has no Effort menu and rejects tool_choice: the last round drops the tools instead.
        let ollama = test_route("ollama", model("llama3"));
        assert!(ollama.effort("high").unwrap().is_none());
        let body = ollama.body(messages(), tools(), "auto", None, 1, true).unwrap();
        assert!(body.get("tools").is_some() && body.get("tool_choice").is_none());
        assert!(ollama.body(messages(), tools(), "none", None, 1, true).unwrap().get("tools").is_none());
        assert_eq!(ollama.post(&reqwest::Client::new(), &body).build().unwrap().url().as_str(), "http://localhost:11434/v1/chat/completions");

        let mut claude = model("claude-x");
        claude.reasoning_efforts = Some([("high".to_string(), Some("high".to_string()))].into());
        let anthropic = test_route("anthropic", claude);
        let request = anthropic.post(&reqwest::Client::new(), &json!({})).build().unwrap();
        assert_eq!(request.url().as_str(), "https://api.anthropic.com/v1/messages");
        assert_eq!(request.headers()["anthropic-version"], providers::ANTHROPIC_VERSION);
        assert!(http_error(401, "{}", "OpenAI").contains("OpenAI API key"));
    }
}
