use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

const API_URL: &str = "https://api.commandcode.ai/provider/v1/chat/completions";
const MODEL: &str = "deepseek/deepseek-v4.1-flash";
const EFFORTS: [&str; 4] = ["off", "low", "high", "max"];
const MAX_REASONING_CHARS: usize = 100_000;

pub struct AiState {
    client: reqwest::Client,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub has_key: bool,
    pub source: Option<&'static str>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiAction {
    pub kind: String,
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
    /// Cost in USD, only when the gateway reports one.
    pub cost: Option<f64>,
}

impl AiUsage {
    fn merge(&mut self, other: &AiUsage) {
        self.input += other.input;
        self.output += other.output;
        self.reasoning += other.reasoning;
        self.cost = match (self.cost, other.cost) {
            (Some(left), Some(right)) => Some(left + right),
            (Some(left), None) => Some(left),
            (None, Some(right)) => Some(right),
            (None, None) => None,
        };
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiTiming {
    pub first_token_ms: u64,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiReply {
    pub content: String,
    pub reasoning: String,
    pub actions: Vec<AiAction>,
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
    Action {
        kind: String,
        id: String,
        name: String,
        detail: String,
        status: String,
    },
    Done {
        input_tokens: u64,
        output_tokens: u64,
        reasoning_tokens: u64,
        cost: Option<f64>,
        first_token_ms: u64,
        duration_ms: u64,
    },
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| home.join(".markdown-viewer-app"))
        .map_err(|e| e.to_string())
}

fn config_key(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(app_dir(app).ok()?.join("config.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
}

fn read_env_key(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != "CMD_API_KEY" {
            continue;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn env_file_key() -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
        }
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env"));
    candidates.into_iter().find_map(|path| read_env_key(&path))
}

/// env var first, then the key saved from Settings, then a .env file.
fn resolve_key(app: &AppHandle) -> Result<(String, &'static str), String> {
    if let Ok(key) = std::env::var("CMD_API_KEY") {
        let key = key.trim();
        if !key.is_empty() {
            return Ok((key.to_string(), "environment"));
        }
    }
    if let Some(key) = config_key(app) {
        return Ok((key, "config"));
    }
    if let Some(key) = env_file_key() {
        return Ok((key, ".env"));
    }
    Err("No Command Code API key is configured. Add one in Settings.".into())
}

#[tauri::command(async)]
pub fn ai_status(app: AppHandle) -> AiStatus {
    match resolve_key(&app) {
        Ok((_, source)) => AiStatus { has_key: true, source: Some(source) },
        Err(_) => AiStatus { has_key: false, source: None },
    }
}

#[tauri::command(async)]
pub fn ai_set_key(app: AppHandle, key: Option<String>) -> Result<AiStatus, String> {
    let dir = app_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }

    let path = dir.join("config.json");
    let mut config = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));

    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(key) => config["apiKey"] = Value::String(key),
        None => {
            if let Some(object) = config.as_object_mut() {
                object.remove("apiKey");
            }
        }
    }

    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(ai_status(app))
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) {
    if let Some(flag) = state.cancels.lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AiState>,
    request_id: String,
    model: String,
    effort: String,
    messages: Vec<Value>,
    web_search: bool,
    on_event: Channel<AiEvent>,
) -> Result<AiReply, String> {
    if model != MODEL {
        return Err("Unsupported model.".into());
    }
    if !EFFORTS.contains(&effort.as_str()) {
        return Err("Unsupported reasoning effort.".into());
    }
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("Invalid request id.".into());
    }
    if messages.is_empty() {
        return Err("No messages to send.".into());
    }

    let (key, _) = resolve_key(&app)?;
    let search_config = crate::web_search::load_config(&app);
    let tools = if web_search && search_config.ready() {
        Some(vec![crate::web_search::tool_definition()])
    } else {
        None
    };

    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let result = run_agent(
        &state.client, &key, &model, &effort, messages, tools, &search_config, &cancel, &on_event,
    )
    .await;
    state.cancels.lock().unwrap().remove(&request_id);
    result
}

const MAX_TOOL_ROUNDS: usize = 3;
const MAX_SEARCHES: usize = 3;

#[allow(clippy::too_many_arguments)]
async fn run_agent(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    effort: &str,
    messages: Vec<Value>,
    tools: Option<Vec<Value>>,
    search_config: &crate::web_search::SearchConfig,
    cancel: &AtomicBool,
    on_event: &Channel<AiEvent>,
) -> Result<AiReply, String> {
    let started = Instant::now();
    let mut conversation = messages;
    let mut reply = AiReply::default();
    let mut first_token_ms = 0u64;
    let mut searches = 0usize;

    for round in 0..=MAX_TOOL_ROUNDS {
        if cancel.load(Ordering::Relaxed) {
            reply.stopped = true;
            break;
        }
        let turn = stream_chat(
            client, key, model, effort, &conversation, tools.as_deref(), cancel, on_event, started, &mut first_token_ms,
        )
        .await?;
        append_block(&mut reply.content, &turn.content);
        append_reasoning(&mut reply.reasoning, &turn.reasoning);
        reply.usage.merge(&turn.usage);
        if turn.stopped {
            reply.stopped = true;
        }
        if turn.calls.is_empty() || reply.stopped || round == MAX_TOOL_ROUNDS {
            break;
        }

        let calls: Vec<Value> = turn
            .calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": { "name": call.name, "arguments": call.arguments }
                })
            })
            .collect();
        conversation.push(json!({
            "role": "assistant",
            "content": if turn.content.is_empty() { Value::Null } else { Value::String(turn.content.clone()) },
            "tool_calls": calls
        }));

        for call in &turn.calls {
            if cancel.load(Ordering::Relaxed) {
                reply.stopped = true;
                break;
            }
            let (content, action) = execute_web_search(search_config, call, &mut searches, cancel, on_event).await;
            conversation.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": content
            }));
            if let Some(action) = action {
                reply.actions.push(action);
            }
        }
        if reply.stopped {
            break;
        }
    }

    reply.timing = AiTiming {
        first_token_ms,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    let _ = on_event.send(AiEvent::Done {
        input_tokens: reply.usage.input,
        output_tokens: reply.usage.output,
        reasoning_tokens: reply.usage.reasoning,
        cost: reply.usage.cost,
        first_token_ms: reply.timing.first_token_ms,
        duration_ms: reply.timing.duration_ms,
    });
    Ok(reply)
}

fn append_block(target: &mut String, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    if !target.is_empty() {
        target.push_str("\n\n");
    }
    target.push_str(text);
}

fn append_reasoning(target: &mut String, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    if !target.is_empty() {
        push_capped(target, "\n\n", MAX_REASONING_CHARS);
    }
    push_capped(target, text, MAX_REASONING_CHARS);
}

struct TurnOutcome {
    content: String,
    reasoning: String,
    usage: AiUsage,
    stopped: bool,
    calls: Vec<ToolCall>,
}

#[allow(clippy::too_many_arguments)]
async fn stream_chat(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    effort: &str,
    messages: &[Value],
    tools: Option<&[Value]>,
    cancel: &AtomicBool,
    on_event: &Channel<AiEvent>,
    run_started: Instant,
    first_token_ms: &mut u64,
) -> Result<TurnOutcome, String> {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
        "max_tokens": 8192,
        "reasoning_effort": effort,
    });
    if let Some(tools) = tools {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = json!("auto");
    }

    let response = client
        .post(API_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| network_error(&e))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(http_error(status.as_u16(), &body));
    }
    // Some gateways report the request cost on a header; keep it as a fallback.
    let header_cost = response.headers().iter().find_map(|(name, value)| {
        if !name.as_str().to_ascii_lowercase().contains("cost") {
            return None;
        }
        value.to_str().ok().and_then(parse_cost)
    });

    let mut content = String::new();
    let mut reasoning = String::new();
    let mut usage = AiUsage::default();
    let mut stopped = false;
    let mut parser = SseParser::default();
    let mut phase = String::new();

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            stopped = true;
            break;
        }
        let chunk = chunk.map_err(|e| network_error(&e))?;
        for item in parser.feed(&chunk) {
            apply_stream_item(
                item,
                &mut content,
                &mut reasoning,
                &mut usage,
                first_token_ms,
                &mut phase,
                run_started,
                header_cost,
                on_event,
            );
        }
    }
    // A stream may end right after [DONE] without a trailing newline.
    for item in parser.finish() {
        apply_stream_item(
            item,
            &mut content,
            &mut reasoning,
            &mut usage,
            first_token_ms,
            &mut phase,
            run_started,
            header_cost,
            on_event,
        );
    }

    if usage.cost.is_none() {
        usage.cost = header_cost;
    }
    let calls = parser.take_calls();
    Ok(TurnOutcome { content, reasoning, usage, stopped, calls })
}

#[allow(clippy::too_many_arguments)]
fn apply_stream_item(
    item: StreamItem,
    content: &mut String,
    reasoning: &mut String,
    usage: &mut AiUsage,
    first_token_ms: &mut u64,
    phase: &mut String,
    run_started: Instant,
    header_cost: Option<f64>,
    on_event: &Channel<AiEvent>,
) {
    match item {
        StreamItem::Reasoning(text) => {
            if *first_token_ms == 0 {
                *first_token_ms = run_started.elapsed().as_millis() as u64;
            }
            if phase.as_str() != "thinking" {
                *phase = "thinking".into();
                let _ = on_event.send(AiEvent::Status { phase: "thinking".into() });
            }
            push_capped(reasoning, &text, MAX_REASONING_CHARS);
            let _ = on_event.send(AiEvent::ReasoningDelta { text });
        }
        StreamItem::Content(text) => {
            if *first_token_ms == 0 {
                *first_token_ms = run_started.elapsed().as_millis() as u64;
            }
            if phase.as_str() != "writing" {
                *phase = "writing".into();
                let _ = on_event.send(AiEvent::Status { phase: "writing".into() });
            }
            content.push_str(&text);
            let _ = on_event.send(AiEvent::Delta { text });
        }
        // Tool call deltas are accumulated by the parser; a run row is emitted
        // only when the call is actually executed.
        StreamItem::Action { .. } => {}
        StreamItem::Usage { input, output, reasoning: reasoning_tokens, cost } => {
            *usage = AiUsage { input, output, reasoning: reasoning_tokens, cost: cost.or(header_cost) };
        }
        StreamItem::Done => {}
    }
}

async fn execute_web_search(
    config: &crate::web_search::SearchConfig,
    call: &ToolCall,
    searches: &mut usize,
    cancel: &AtomicBool,
    on_event: &Channel<AiEvent>,
) -> (String, Option<AiAction>) {
    let id = call.id.clone();
    if call.name != "web_search" {
        let action = AiAction {
            kind: "tool".into(),
            id,
            name: call.name.clone(),
            detail: "Unknown tool".into(),
            status: "error".into(),
        };
        send_action(on_event, &action);
        return (format!("Unknown tool: {}", call.name), Some(action));
    }

    let query = serde_json::from_str::<Value>(&call.arguments)
        .ok()
        .and_then(|value| value.get("query").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default()
        .trim()
        .to_string();
    if query.is_empty() {
        return failed_search(
            on_event,
            id,
            "Missing query.",
            "The web_search call is missing a query.".into(),
        );
    }
    if *searches >= MAX_SEARCHES {
        return failed_search(
            on_event,
            id,
            "Search limit reached.",
            "Web search limit reached for this response.".into(),
        );
    }
    *searches += 1;

    let safe_query = truncate_action_text(&query, 160);
    let running = AiAction {
        kind: "web".into(),
        id: id.clone(),
        name: "Web search".into(),
        detail: format!("\"{safe_query}\""),
        status: "running".into(),
    };
    send_action(on_event, &running);
    let _ = on_event.send(AiEvent::Status { phase: "searching".into() });

    let result = tokio::select! {
        result = crate::web_search::search(config, &query) => result,
        _ = async {
            while !cancel.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        } => Err("Search stopped.".to_string()),
    };

    match result {
        Ok(response) => {
            let action = AiAction {
                kind: "web".into(),
                id,
                name: "Web search".into(),
                detail: format!(
                    "\"{safe_query}\" · {} result{} · {}{}",
                    response.results.len(),
                    if response.results.len() == 1 { "" } else { "s" },
                    response.provider,
                    if response.attempts > 1 {
                        format!(" · {} attempts", response.attempts)
                    } else {
                        String::new()
                    }
                ),
                status: "done".into(),
            };
            send_action(on_event, &action);
            (crate::web_search::format_results(&query, &response), Some(action))
        }
        Err(error) => {
            let error = truncate_action_text(&error, 300);
            let action = AiAction {
                kind: "web".into(),
                id,
                name: "Web search".into(),
                detail: format!("\"{safe_query}\" · {error}"),
                status: "error".into(),
            };
            send_action(on_event, &action);
            (format!("Web search failed: {error}"), Some(action))
        }
    }
}

fn failed_search(on_event: &Channel<AiEvent>, id: String, short: &str, tool_content: String) -> (String, Option<AiAction>) {
    let action = AiAction {
        kind: "web".into(),
        id,
        name: "Web search".into(),
        detail: short.to_string(),
        status: "error".into(),
    };
    send_action(on_event, &action);
    (tool_content, Some(action))
}

fn send_action(on_event: &Channel<AiEvent>, action: &AiAction) {
    let _ = on_event.send(AiEvent::Action {
        kind: action.kind.clone(),
        id: action.id.clone(),
        name: action.name.clone(),
        detail: action.detail.clone(),
        status: action.status.clone(),
    });
}

fn truncate_action_text(text: &str, max: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        return text;
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[tauri::command]
pub async fn ai_title(
    app: AppHandle,
    state: State<'_, AiState>,
    model: String,
    messages: Vec<Value>,
) -> Result<String, String> {
    if model != MODEL {
        return Err("Unsupported model.".into());
    }
    let (key, _) = resolve_key(&app)?;
    let body = json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "max_tokens": 100,
        "reasoning_effort": "off",
    });
    let response = state
        .client
        .post(API_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| network_error(&e))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(http_error(status.as_u16(), &text));
    }
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let title = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if title.is_empty() {
        return Err("The gateway returned an empty title.".into());
    }
    Ok(title)
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

fn http_error(status: u16, body: &str) -> String {
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
        401 => "Your Command Code API key was rejected. Check it in Settings.",
        403 => "This Command Code account can't use the API. Check your plan or key.",
        429 => "Mark is rate-limited right now. Try again in a moment.",
        502 | 503 | 504 => "Command Code is temporarily unavailable. Try again shortly.",
        _ => "",
    };
    match (hint.is_empty(), message.is_empty()) {
        (false, _) => format!("{hint} ({status})"),
        (true, false) => format!("Command Code error ({status}): {message}"),
        (true, true) => format!("Command Code error ({status})."),
    }
}

fn network_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "Mark took too long to respond. Check your connection and try again.".into()
    } else {
        "Couldn't reach Command Code. Check your connection and try again.".into()
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
enum StreamItem {
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

#[derive(Default)]
struct SseParser {
    buf: Vec<u8>,
    tools: HashMap<usize, ToolCall>,
}

impl SseParser {
    fn feed(&mut self, chunk: &[u8]) -> Vec<StreamItem> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(at) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=at).collect();
            let line = String::from_utf8_lossy(&line);
            if let Some(payload) = line.trim_end().strip_prefix("data:") {
                self.payload(payload.trim(), &mut out);
            }
        }
        out
    }

    /// Flush a final line that arrived without its trailing newline.
    fn finish(&mut self) -> Vec<StreamItem> {
        let mut out = Vec::new();
        if self.buf.is_empty() {
            return out;
        }
        let line: Vec<u8> = self.buf.drain(..).collect();
        let line = String::from_utf8_lossy(&line);
        if let Some(payload) = line.trim_end().strip_prefix("data:") {
            self.payload(payload.trim(), &mut out);
        }
        out
    }

    fn take_calls(&mut self) -> Vec<ToolCall> {
        let mut calls: Vec<(usize, ToolCall)> = std::mem::take(&mut self.tools).into_iter().collect();
        calls.sort_by_key(|(index, _)| *index);
        calls
            .into_iter()
            .map(|(index, mut call)| {
                if call.id.is_empty() {
                    call.id = format!("call-{index}");
                }
                call
            })
            .filter(|call| !call.name.is_empty())
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
            if let Some(name) = call.get("function").and_then(|f| f.get("name")).and_then(Value::as_str).filter(|name| !name.is_empty()) {
                if entry.name.is_empty() {
                    entry.name = name.to_string();
                } else if !entry.name.ends_with(name) {
                    entry.name.push_str(name);
                }
            }
            if let Some(arguments) = call.get("function").and_then(|f| f.get("arguments")) {
                match arguments {
                    Value::String(text) => entry.arguments.push_str(text),
                    Value::Null => {}
                    other => entry.arguments = other.to_string(),
                }
            }
            if !entry.name.is_empty() {
                let id = if entry.id.is_empty() { format!("tool-{index}") } else { entry.id.clone() };
                out.push(StreamItem::Action {
                    id,
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
        let mut parser = SseParser::default();
        assert!(parser.feed(br#"data: {"choices":[{"delta":{"reasoni"#).is_empty());
        let items = parser.feed(b"ng_content\":\"think\"}}]}\n\n");
        assert_eq!(items, vec![StreamItem::Reasoning("think".into())]);

        let items = parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n");
        assert_eq!(items, vec![StreamItem::Content("hi".into()), StreamItem::Done]);
    }

    #[test]
    fn parses_usage_and_tool_calls() {
        let mut parser = SseParser::default();
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
        assert!(items.contains(&StreamItem::Done));

        let calls = parser.take_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "search");
        assert_eq!(calls[0].arguments, "query more");
    }

    #[test]
    fn merges_usage_across_turns() {
        let mut total = AiUsage::default();
        total.merge(&AiUsage { input: 10, output: 4, reasoning: 2, cost: Some(0.001) });
        total.merge(&AiUsage { input: 3, output: 5, reasoning: 1, cost: None });
        assert_eq!(total.input, 13);
        assert_eq!(total.output, 9);
        assert_eq!(total.reasoning, 3);
        assert_eq!(total.cost, Some(0.001));
    }

    #[test]
    fn parses_cost_variants_without_choices() {
        let mut parser = SseParser::default();
        let items = parser.feed(
            b"data: {\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_cost\":\"$0.0012\"}}\n",
        );
        assert_eq!(items, vec![StreamItem::Usage { input: 1, output: 2, reasoning: 0, cost: Some(0.0012) }]);
        assert_eq!(parse_cost("$0.50"), Some(0.5));
        assert_eq!(parse_cost("nope"), None);
    }

    #[test]
    fn reads_env_key_variants() {
        let path = std::env::temp_dir().join(format!("mdviewer-env-{}", std::process::id()));
        std::fs::write(&path, "# comment\nOTHER=x\nexport CMD_API_KEY = \"user_abc\"\n").unwrap();
        assert_eq!(read_env_key(&path).as_deref(), Some("user_abc"));
        std::fs::write(&path, "CMD_API_KEY=user_plain\r\n").unwrap();
        assert_eq!(read_env_key(&path).as_deref(), Some("user_plain"));
        std::fs::write(&path, "CMD_API_KEY=\n").unwrap();
        assert_eq!(read_env_key(&path), None);
        let _ = std::fs::remove_file(path);
    }
}
