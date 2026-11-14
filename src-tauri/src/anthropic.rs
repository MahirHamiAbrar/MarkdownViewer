//! The `anthropic-messages` protocol: request conversion from the chat-completions shape the
//! webview builds, and the Messages API event stream.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::ai::{AiToolCall, Protocol, StreamItem};

fn text_of(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

/// Builds a Messages API request. `effort` (the wire spelling) turns adaptive thinking on;
/// models without an Effort menu are sent neither parameter.
pub fn body(
    model: &str,
    messages: Vec<Value>,
    tools: Vec<Value>,
    tool_choice: &str,
    effort: Option<&str>,
    max_tokens: u64,
    stream: bool,
) -> Result<Value, String> {
    let mut system = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for message in messages {
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        match message.get("role").and_then(Value::as_str).unwrap_or("") {
            "system" => system.push(text_of(&content)),
            "user" => out.push(json!({ "role": "user", "content": content })),
            "assistant" => {
                // A turn handed back from this API goes in unchanged: thinking blocks are signed.
                if let Some(blocks) = message.get("provider_blocks").and_then(Value::as_array).filter(|blocks| !blocks.is_empty()) {
                    out.push(json!({ "role": "assistant", "content": blocks }));
                    continue;
                }
                let mut blocks = Vec::new();
                let text = text_of(&content);
                if !text.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for call in message.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
                    let function = call.get("function").cloned().unwrap_or(Value::Null);
                    let input = function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .and_then(|arguments| serde_json::from_str::<Value>(arguments).ok())
                        .filter(Value::is_object)
                        .unwrap_or_else(|| json!({}));
                    blocks.push(json!({ "type": "tool_use", "id": call.get("id"), "name": function.get("name"), "input": input }));
                }
                if !blocks.is_empty() {
                    out.push(json!({ "role": "assistant", "content": blocks }));
                }
            }
            "tool" => {
                let result = json!({ "type": "tool_result", "tool_use_id": message.get("tool_call_id"), "content": text_of(&content) });
                // Every result of one round belongs in a single user message.
                let merged = out.last_mut().and_then(|last| last.get_mut("content")).and_then(Value::as_array_mut).filter(|blocks| {
                    blocks.first().and_then(|block| block.get("type")).and_then(Value::as_str) == Some("tool_result")
                });
                match merged {
                    Some(blocks) => blocks.push(result),
                    None => out.push(json!({ "role": "user", "content": [result] })),
                }
            }
            other => return Err(format!("Unsupported message role “{other}”.")),
        }
    }

    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": out,
        "stream": stream,
        "cache_control": { "type": "ephemeral" },
    });
    let system = system.join("\n\n");
    if !system.trim().is_empty() {
        body["system"] = json!(system);
    }
    if let Some(effort) = effort {
        body["thinking"] = json!({ "type": "adaptive", "display": "summarized" });
        body["output_config"] = json!({ "effort": effort });
    }
    if !tools.is_empty() {
        let tools: Vec<Value> = tools
            .iter()
            .map(|tool| {
                let function = tool.get("function").unwrap_or(tool);
                json!({
                    "name": function.get("name"),
                    "description": function.get("description").and_then(Value::as_str).unwrap_or(""),
                    "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object" })),
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
        if tool_choice == "none" {
            body["tool_choice"] = json!({ "type": "none" });
        }
    }
    Ok(body)
}

/// The text of a non-streamed reply.
pub fn reply_text(message: &Value) -> String {
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string()
}

struct Block {
    value: Value,
    /// A tool call's arguments as streamed JSON text.
    partial: String,
}

#[derive(Default)]
pub struct Parser {
    blocks: BTreeMap<u64, Block>,
    input_tokens: u64,
    stop_reason: Option<String>,
    error: Option<String>,
}

fn append(value: &mut Value, field: &str, text: &str) {
    let current = value.get(field).and_then(Value::as_str).unwrap_or("");
    value[field] = Value::String(format!("{current}{text}"));
}

fn block_type(block: &Block) -> &str {
    block.value.get("type").and_then(Value::as_str).unwrap_or("")
}

impl Protocol for Parser {
    fn payload(&mut self, payload: &str, out: &mut Vec<StreamItem>) {
        let Ok(event) = serde_json::from_str::<Value>(payload) else {
            return;
        };
        let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                let usage = &event["message"]["usage"];
                self.input_tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
                    .iter()
                    .filter_map(|key| usage.get(*key).and_then(Value::as_u64))
                    .sum();
            }
            "content_block_start" => {
                let value = event.get("content_block").cloned().unwrap_or(Value::Null);
                let block = Block { value, partial: String::new() };
                if block_type(&block) == "tool_use" {
                    out.push(StreamItem::Action {
                        id: block.value["id"].as_str().unwrap_or("").to_string(),
                        name: block.value["name"].as_str().unwrap_or("").to_string(),
                        detail: String::new(),
                    });
                }
                self.blocks.insert(index, block);
            }
            "content_block_delta" => {
                let Some(block) = self.blocks.get_mut(&index) else { return };
                let delta = &event["delta"];
                let text = |key: &str| delta.get(key).and_then(Value::as_str).unwrap_or("");
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" if !text("text").is_empty() => {
                        append(&mut block.value, "text", text("text"));
                        out.push(StreamItem::Content(text("text").to_string()));
                    }
                    "thinking_delta" if !text("thinking").is_empty() => {
                        append(&mut block.value, "thinking", text("thinking"));
                        out.push(StreamItem::Reasoning(text("thinking").to_string()));
                    }
                    "signature_delta" => append(&mut block.value, "signature", text("signature")),
                    "input_json_delta" => {
                        block.partial.push_str(text("partial_json"));
                        out.push(StreamItem::Action {
                            id: block.value["id"].as_str().unwrap_or("").to_string(),
                            name: block.value["name"].as_str().unwrap_or("").to_string(),
                            detail: block.partial.clone(),
                        });
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(reason) = event["delta"].get("stop_reason").and_then(Value::as_str) {
                    self.stop_reason = Some(reason.to_string());
                }
                if let Some(output) = event["usage"].get("output_tokens").and_then(Value::as_u64) {
                    out.push(StreamItem::Usage { input: self.input_tokens, output, reasoning: 0, cost: None });
                }
            }
            "message_stop" => out.push(StreamItem::Done),
            "error" => {
                self.error = Some(event["error"].get("message").and_then(Value::as_str).unwrap_or("the stream failed").to_string());
            }
            _ => {}
        }
    }

    fn tool_calls(&self) -> Vec<AiToolCall> {
        self.blocks
            .values()
            .filter(|block| block_type(block) == "tool_use")
            .map(|block| AiToolCall {
                id: block.value["id"].as_str().unwrap_or("").to_string(),
                name: block.value["name"].as_str().unwrap_or("").to_string(),
                arguments: if block.partial.trim().is_empty() { "{}".into() } else { block.partial.clone() },
            })
            .collect()
    }

    fn finish(&mut self, content: &str) -> Result<Option<Value>, String> {
        if let Some(error) = self.error.take() {
            return Err(error);
        }
        if self.stop_reason.as_deref() == Some("refusal") && content.trim().is_empty() {
            return Err("the model declined this request.".into());
        }
        if !self.blocks.values().any(|block| block_type(block) == "tool_use") {
            return Ok(None); // nothing to hand back: the answer is plain text
        }
        let blocks: Vec<Value> = self
            .blocks
            .values()
            .filter(|block| !(block_type(block) == "text" && block.value["text"].as_str().unwrap_or("").is_empty()))
            .map(|block| {
                let mut value = block.value.clone();
                if block_type(block) == "tool_use" {
                    value["input"] = serde_json::from_str::<Value>(&block.partial).ok().filter(Value::is_object).unwrap_or_else(|| json!({}));
                }
                value
            })
            .collect();
        Ok(Some(Value::Array(blocks)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::SseParser;

    #[test]
    fn converts_a_tool_round() {
        let messages = vec![
            json!({ "role": "system", "content": "You are Mark." }),
            json!({ "role": "user", "content": "Find it" }),
            json!({ "role": "assistant", "content": "", "tool_calls": [
                { "id": "a", "type": "function", "function": { "name": "search", "arguments": "{\"q\":\"x\"}" } },
                { "id": "b", "type": "function", "function": { "name": "read", "arguments": "not json" } },
            ] }),
            json!({ "role": "tool", "tool_call_id": "a", "content": "hit" }),
            json!({ "role": "tool", "tool_call_id": "b", "content": "text" }),
            json!({ "role": "assistant", "content": "ignored", "provider_blocks": [{ "type": "thinking", "thinking": "", "signature": "sig" }, { "type": "text", "text": "kept" }] }),
        ];
        let tools = vec![json!({ "type": "function", "function": { "name": "search", "description": "d", "parameters": { "type": "object" } } })];
        let body = body("claude-x", messages, tools, "none", Some("high"), 1000, true).unwrap();

        assert_eq!(body["system"], "You are Mark.");
        let sent = body["messages"].as_array().unwrap();
        assert_eq!(sent.len(), 4, "{sent:#?}");
        assert_eq!(sent[1]["content"][0], json!({ "type": "tool_use", "id": "a", "name": "search", "input": { "q": "x" } }));
        assert_eq!(sent[1]["content"][1]["input"], json!({}), "bad arguments become an empty object");
        assert_eq!(sent[2]["role"], "user");
        assert_eq!(sent[2]["content"].as_array().unwrap().len(), 2, "both results in one message");
        assert_eq!(sent[2]["content"][1], json!({ "type": "tool_result", "tool_use_id": "b", "content": "text" }));
        assert_eq!(sent[3]["content"][0]["signature"], "sig");
        assert_eq!(body["tools"][0], json!({ "name": "search", "description": "d", "input_schema": { "type": "object" } }));
        assert_eq!(body["tool_choice"]["type"], "none");
        assert_eq!((&body["thinking"]["type"], &body["output_config"]["effort"]), (&json!("adaptive"), &json!("high")));

        let plain = super::body("claude-y", vec![json!({ "role": "user", "content": "hi" })], vec![], "auto", None, 10, false).unwrap();
        assert!(plain.get("thinking").is_none() && plain.get("output_config").is_none() && plain.get("tools").is_none());
        assert_eq!(reply_text(&json!({ "content": [{ "type": "thinking", "thinking": "t" }, { "type": "text", "text": " Title " }] })), "Title");
    }

    #[test]
    fn parses_a_stream_with_thinking_and_tools() {
        let mut parser = SseParser::<Parser>::default();
        let stream = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":90}}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"\"}}\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hm\"}}\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig\"}}\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Looking\"}}\n",
            "data: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"search\",\"input\":{}}}\n",
            "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\"}}\n",
            "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"x\\\"}\"}}\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":7}}\n",
            "data: {\"type\":\"message_stop\"}",
        );
        let mut items = parser.feed(stream.as_bytes());
        items.extend(parser.finish());
        assert!(items.contains(&StreamItem::Reasoning("hm".into())));
        assert!(items.contains(&StreamItem::Content("Looking".into())));
        assert!(items.contains(&StreamItem::Usage { input: 100, output: 7, reasoning: 0, cost: None }));
        assert!(items.contains(&StreamItem::Action { id: "toolu_1".into(), name: "search".into(), detail: "{\"q\":\"x\"}".into() }));
        assert_eq!(items.last(), Some(&StreamItem::Done));
        assert_eq!(parser.protocol.tool_calls(), [AiToolCall { id: "toolu_1".into(), name: "search".into(), arguments: "{\"q\":\"x\"}".into() }]);

        let blocks = parser.protocol.finish("Looking").unwrap().unwrap();
        assert_eq!(blocks[0], json!({ "type": "thinking", "thinking": "hm", "signature": "sig" }));
        assert_eq!(blocks[2]["input"], json!({ "q": "x" }));
    }

    #[test]
    fn reports_stream_errors_and_refusals() {
        let mut parser = SseParser::<Parser>::default();
        parser.feed(b"data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n");
        assert_eq!(parser.protocol.finish(""), Err("Overloaded".into()));

        let mut parser = SseParser::<Parser>::default();
        parser.feed(b"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\"},\"usage\":{\"output_tokens\":0}}\n");
        assert!(parser.protocol.finish("").is_err());

        let mut parser = SseParser::<Parser>::default();
        parser.feed(b"data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n");
        assert_eq!(parser.protocol.finish("answer"), Ok(None), "a plain answer hands nothing back");
    }
}
