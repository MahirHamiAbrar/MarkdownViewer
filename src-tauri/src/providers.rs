//! Model providers for Big Brain, shaped after deepseek-harness: a provider is a route with a
//! permanent lowercase id, a wire protocol (`api`), a base URL, a credential and a model list.
//! Built-in routes come from `catalog()`; `providers.json` in the app folder overrides them
//! field by field and adds custom ones.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};

use crate::ai::{http_error, network_error, AiState};
use crate::fsutil;

pub const OPENAI: &str = "openai-completions";
pub const ANTHROPIC: &str = "anthropic-messages";
pub const ANTHROPIC_VERSION: &str = "2026-10-21";
const KEYCHAIN_SERVICE: &str = "MarkdownEditor";
const MAX_MODELS: usize = 2000;
/// Fields a saved provider entry may carry; anything else from the webview is dropped.
const FIELDS: [&str; 11] =
    ["name", "api", "baseURL", "apiKeyEnv", "noKey", "reasoning", "reasoningEfforts", "compat", "headers", "models", "vision"];

/// Effort level shown in the menu -> the spelling sent on the wire. `None` sends nothing.
pub type Efforts = BTreeMap<String, Option<String>>;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_efforts: Option<Efforts>,
    /// Whether the model accepts images; unset falls back to the provider's `vision`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
}

/// Request-shape switches for gateways that differ from the plain protocol.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Compat {
    /// `max_tokens` (default) or `max_completion_tokens`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens_field: Option<String>,
    /// `deepseek`: send `thinking: {type: enabled|disabled}` beside the effort.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_format: Option<String>,
    /// `openrouter`: send `reasoning: {effort}` instead of `reasoning_effort`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_format: Option<String>,
    /// `false`: the endpoint rejects `tool_choice`; tools are left out instead of forbidden.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub api: String,
    #[serde(rename = "baseURL")]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub no_key: bool,
    /// Default effort level for this route.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    /// Levels for models that declare none of their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_efforts: Option<Efforts>,
    #[serde(default)]
    pub compat: Compat,
    /// Whether this route's models accept images (page images of a PDF). Unset means yes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub models: Vec<Model>,
    #[serde(default, skip_deserializing)]
    pub builtin: bool,
}

impl Provider {
    pub fn model(&self, id: &str) -> Option<&Model> {
        self.models.iter().find(|model| model.id == id)
    }

    /// A model's own levels win; otherwise the route's. Empty means "no Effort menu".
    pub fn efforts<'a>(&'a self, model: &'a Model) -> Option<&'a Efforts> {
        model.reasoning_efforts.as_ref().or(self.reasoning_efforts.as_ref()).filter(|efforts| !efforts.is_empty())
    }

    pub fn display_name(&self) -> &str {
        if self.name.is_empty() { &self.id } else { &self.name }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url.trim_end_matches('/'), path)
    }
}

/// The lowest level a model offers, for titles and summaries.
pub fn cheapest_effort(efforts: &Efforts) -> Option<&str> {
    ["off", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .find(|level| efforts.contains_key(*level))
        .or_else(|| efforts.keys().next().map(String::as_str))
}

fn catalog() -> Vec<(&'static str, Value)> {
    vec![
        ("deepseek", json!({
            "name": "DeepSeek", "api": OPENAI, "baseURL": "https://api.deepseek.com", "apiKeyEnv": "DEEPSEEK_API_KEY",
            "reasoning": "high", "reasoningEfforts": { "off": null, "low": "low", "high": "high", "max": "max" },
            "compat": { "thinkingFormat": "deepseek" }, "vision": false,
        })),
        ("openai", json!({
            "name": "OpenAI", "api": OPENAI, "baseURL": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY",
            "reasoning": "auto", "reasoningEfforts": { "auto": null, "low": "low", "medium": "medium", "high": "high" },
            "compat": { "maxTokensField": "max_completion_tokens" },
        })),
        ("anthropic", json!({
            "name": "Anthropic", "api": ANTHROPIC, "baseURL": "https://api.anthropic.com", "apiKeyEnv": "ANTHROPIC_API_KEY",
            "reasoning": "high",
        })),
        ("openrouter", json!({
            "name": "OpenRouter", "api": OPENAI, "baseURL": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY",
            "reasoning": "auto", "reasoningEfforts": { "auto": null, "low": "low", "medium": "medium", "high": "high" },
            "compat": { "reasoningFormat": "openrouter" },
        })),
        ("ollama", json!({
            "name": "Ollama", "api": OPENAI, "baseURL": "http://localhost:11434/v1", "noKey": true,
            "compat": { "toolChoice": false },
        })),
        ("commandcode", json!({
            "name": "Command Code", "api": OPENAI, "baseURL": "https://api.commandcode.ai/provider/v1", "apiKeyEnv": "CMD_API_KEY",
            "reasoning": "high", "reasoningEfforts": { "off": "off", "low": "low", "high": "high", "max": "max" },
            "models": [{ "id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "vision": false }],
        })),
    ]
}

fn user_entries(dir: &Path) -> Map<String, Value> {
    std::fs::read_to_string(dir.join("providers.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.get("providers").and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

fn write_user_entries(dir: &Path, entries: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&json!({ "providers": entries })).map_err(|e| e.to_string())?;
    fsutil::atomic_write(&dir.join("providers.json"), text.as_bytes(), true).map_err(|e| e.to_string())
}

fn build(id: &str, base: Option<&Value>, overlay: Option<&Value>) -> Option<Provider> {
    let mut entry = base.cloned().unwrap_or_else(|| json!({}));
    if let (Some(target), Some(overlay)) = (entry.as_object_mut(), overlay.and_then(Value::as_object)) {
        for (key, value) in overlay {
            target.insert(key.clone(), value.clone());
        }
    }
    let mut provider: Provider = serde_json::from_value(entry).ok()?;
    provider.id = id.to_string();
    provider.builtin = base.is_some();
    Some(provider)
}

/// Built-in routes first (with the user's overrides), then custom ones by id.
pub fn load(dir: &Path) -> Vec<Provider> {
    let user = user_entries(dir);
    let catalog = catalog();
    let mut out: Vec<Provider> =
        catalog.iter().filter_map(|(id, base)| build(id, Some(base), user.get(*id))).collect();
    for (id, entry) in &user {
        if catalog.iter().any(|(builtin, _)| builtin == id) {
            continue;
        }
        if let Some(provider) = build(id, None, Some(entry)).filter(|provider| validate(provider).is_ok()) {
            out.push(provider);
        }
    }
    out
}

pub fn find(dir: &Path, id: &str) -> Result<Provider, String> {
    load(dir).into_iter().find(|provider| provider.id == id).ok_or_else(|| format!("Unknown model provider “{id}”."))
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    (1..=32).contains(&id.len())
        && chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.ends_with(".localhost") || host.trim_matches(|c| c == '[' || c == ']').parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn validate(provider: &Provider) -> Result<(), String> {
    if !valid_id(&provider.id) {
        return Err("Provider ID must be 1 to 32 lowercase letters, digits, - or _.".into());
    }
    if ![OPENAI, ANTHROPIC].contains(&provider.api.as_str()) {
        return Err(format!("API protocol must be {OPENAI} or {ANTHROPIC}."));
    }
    let url = reqwest::Url::parse(&provider.base_url).map_err(|_| "Base URL is not a valid URL.".to_string())?;
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "https" => {}
        // A key must never travel in clear text; plain HTTP is for local or keyless servers.
        "http" if provider.no_key || is_loopback(host) => {}
        "http" => return Err("Use https:// for a provider that needs an API key.".into()),
        _ => return Err("Base URL must start with https:// or http://.".into()),
    }
    if host.is_empty() {
        return Err("Base URL needs a host.".into());
    }
    if provider.models.len() > MAX_MODELS {
        return Err("Too many models.".into());
    }
    if provider.models.iter().any(|model| model.id.trim().is_empty() || model.id.len() > 200) {
        return Err("A model id is empty or too long.".into());
    }
    if provider.headers.iter().any(|(name, value)| name.trim().is_empty() || value.contains(['\r', '\n'])) {
        return Err("A header is empty or spans lines.".into());
    }
    if let Some(var) = &provider.api_key_env {
        if var.is_empty() || !var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("The key's environment variable name may only hold letters, digits and _.".into());
        }
    }
    Ok(())
}

// ---------- credentials ----------

fn credentials_path(dir: &Path) -> PathBuf {
    dir.join("credentials.json")
}

fn file_keys(dir: &Path) -> Map<String, Value> {
    std::fs::read_to_string(credentials_path(dir))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn set_file_key(dir: &Path, id: &str, key: Option<&str>) -> Result<(), String> {
    let mut keys = file_keys(dir);
    match key {
        Some(key) => keys.insert(id.to_string(), Value::String(key.to_string())),
        None => keys.remove(id),
    };
    let path = credentials_path(dir);
    if keys.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    let text = serde_json::to_string_pretty(&Value::Object(keys)).map_err(|e| e.to_string())?;
    fsutil::atomic_write(&path, text.as_bytes(), true).map_err(|e| e.to_string())
}

fn keychain(id: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, id).ok()
}

pub(crate) fn read_env_key(path: &Path, var: &str) -> Option<String> {
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
        if key.trim() != var {
            continue;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// The environment variable wins (a per-run override), then the OS keychain, then the
/// owner-only fallback file. Development builds also read the project's `.env`.
pub fn resolve_key(dir: &Path, provider: &Provider) -> Option<(String, &'static str)> {
    if let Some(var) = &provider.api_key_env {
        if let Some(key) = std::env::var(var).ok().map(|key| key.trim().to_string()).filter(|key| !key.is_empty()) {
            return Some((key, "environment"));
        }
    }
    if let Some(key) = keychain(&provider.id).and_then(|entry| entry.get_password().ok()).filter(|key| !key.is_empty()) {
        return Some((key, "keychain"));
    }
    if let Some(key) = file_keys(dir).get(&provider.id).and_then(Value::as_str).filter(|key| !key.is_empty()) {
        return Some((key.to_string(), "file"));
    }
    #[cfg(debug_assertions)]
    if let Some(var) = &provider.api_key_env {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env");
        if let Some(key) = read_env_key(&path, var) {
            return Some((key, ".env"));
        }
    }
    None
}

/// Stores a key in the OS keychain, or in the owner-only file when no keychain answers.
/// Returns where it went. `None` removes it from both.
pub fn set_key(dir: &Path, id: &str, key: Option<&str>) -> Result<&'static str, String> {
    let entry = keychain(id);
    match key {
        Some(key) => {
            if entry.is_some_and(|entry| entry.set_password(key).is_ok()) {
                set_file_key(dir, id, None)?;
                Ok("keychain")
            } else {
                set_file_key(dir, id, Some(key))?;
                Ok("file")
            }
        }
        None => {
            if let Some(entry) = entry {
                let _ = entry.delete_credential();
            }
            set_file_key(dir, id, None)?;
            Ok("none")
        }
    }
}

/// Moves the key the app used to keep in `config.json` into the keychain.
pub fn migrate_legacy_key(dir: &Path) {
    let path = dir.join("config.json");
    let Some(mut config) = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) else {
        return;
    };
    let Some(key) = config.get("apiKey").and_then(Value::as_str).map(str::trim).filter(|key| !key.is_empty()).map(str::to_owned) else {
        return;
    };
    if set_key(dir, "commandcode", Some(&key)).is_err() {
        return; // keep the old file until the key is safely elsewhere
    }
    if let Some(object) = config.as_object_mut() {
        object.remove("apiKey");
        if object.is_empty() {
            let _ = std::fs::remove_file(&path);
        } else if let Ok(text) = serde_json::to_string_pretty(&config) {
            let _ = fsutil::atomic_write(&path, text.as_bytes(), true);
        }
    }
}

// ---------- model listing ----------

fn number(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| value.get(*key).and_then(Value::as_u64))
}

/// Anthropic reports per-model capabilities; a model gets an Effort menu only when it
/// takes both adaptive thinking and the effort parameter.
fn anthropic_efforts(model: &Value) -> Option<Efforts> {
    let caps = model.get("capabilities")?;
    let supported = |value: Option<&Value>| value.and_then(|v| v.get("supported")).and_then(Value::as_bool) == Some(true);
    if !supported(caps.get("thinking").and_then(|t| t.get("types")).and_then(|t| t.get("adaptive"))) {
        return None;
    }
    let effort = caps.get("effort").filter(|effort| supported(Some(effort)))?;
    let levels: Efforts = ["low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .filter(|level| supported(effort.get(*level)))
        .map(|level| (level.to_string(), Some(level.to_string())))
        .collect();
    (!levels.is_empty()).then_some(levels)
}

// ponytail: name-based filter for OpenAI's mixed catalog; no capability field exists on /models. Edit providers.json to add one back.
fn is_chat_model(provider: &Provider, id: &str) -> bool {
    provider.id != "openai"
        || !["embedding", "whisper", "tts", "dall-e", "image", "audio", "realtime", "moderation", "transcribe", "babbage", "davinci", "sora"]
            .iter()
            .any(|part| id.contains(part))
}

fn parse_models(provider: &Provider, body: &Value) -> Vec<Model> {
    let list = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    list.iter()
        .filter_map(|item| {
            let id = item.get("id").or_else(|| item.get("name")).and_then(Value::as_str)?.trim();
            if id.is_empty() || !is_chat_model(provider, id) {
                return None;
            }
            let name = item.get("display_name").or_else(|| item.get("name")).and_then(Value::as_str).filter(|name| *name != id);
            Some(Model {
                id: id.to_string(),
                name: name.map(str::to_owned),
                context_window: number(item, &["max_input_tokens", "context_length", "context_window"]),
                max_tokens: number(item, &["max_tokens", "max_output_tokens"]),
                reasoning_efforts: if provider.api == ANTHROPIC { anthropic_efforts(item) } else { None },
                vision: None,
            })
        })
        .take(MAX_MODELS)
        .collect()
}

pub fn authorize(provider: &Provider, key: Option<&str>, mut request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if provider.api == ANTHROPIC {
        request = request.header("anthropic-version", ANTHROPIC_VERSION);
        if let Some(key) = key {
            request = request.header("x-api-key", key);
        }
    } else if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    for (name, value) in &provider.headers {
        request = request.header(name, value);
    }
    request
}

async fn fetch_models(client: &reqwest::Client, provider: &Provider, key: Option<&str>) -> Result<Vec<Model>, String> {
    let url = if provider.api == ANTHROPIC { provider.url("v1/models?limit=1000") } else { provider.url("models") };
    let response = authorize(provider, key, client.get(url))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| network_error(&e, provider.display_name()))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(http_error(status.as_u16(), &text, provider.display_name()));
    }
    let body: Value = serde_json::from_str(&text).map_err(|_| "The provider's model list was not JSON.".to_string())?;
    let models = parse_models(provider, &body);
    if models.is_empty() {
        return Err("The provider returned no models. Add model ids by hand.".into());
    }
    Ok(models)
}

// ---------- commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    #[serde(flatten)]
    provider: Provider,
    has_key: bool,
    /// `environment`, `keychain`, `file` or `.env`.
    key_source: Option<&'static str>,
    key_preview: Option<String>,
}

fn view(dir: &Path, provider: Provider) -> ProviderView {
    let key = resolve_key(dir, &provider);
    let preview = key.as_ref().and_then(|(key, _)| {
        let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        (key.chars().count() >= 12).then(|| format!("…{tail}"))
    });
    ProviderView { has_key: key.is_some(), key_source: key.map(|(_, source)| source), key_preview: preview, provider }
}

#[tauri::command(async)]
pub fn providers_list(app: AppHandle) -> Result<Vec<ProviderView>, String> {
    let dir = fsutil::app_dir(&app)?;
    Ok(load(&dir).into_iter().map(|provider| view(&dir, provider)).collect())
}

fn save_at(dir: &Path, input: &Value) -> Result<Provider, String> {
    let id = input.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let catalog = catalog();
    let base = catalog.iter().find(|(builtin, _)| *builtin == id).map(|(_, base)| base);
    let mut user = user_entries(dir);
    let previous = build(&id, base, user.get(&id));

    let mut entry = user.get(&id).and_then(Value::as_object).cloned().unwrap_or_default();
    for field in FIELDS {
        if let Some(value) = input.get(field) {
            entry.insert(field.to_string(), value.clone());
        }
    }
    let entry = Value::Object(entry);
    let provider = build(&id, base, Some(&entry)).ok_or("That provider is missing its protocol or base URL.")?;
    validate(&provider)?;

    // A key belongs to the endpoint it was entered for: never send it to a new address.
    if previous.is_some_and(|previous| previous.base_url != provider.base_url) {
        set_key(dir, &id, None)?;
    }
    user.insert(id, entry);
    write_user_entries(dir, &user)?;
    Ok(provider)
}

#[tauri::command(async)]
pub fn provider_save(app: AppHandle, provider: Value) -> Result<ProviderView, String> {
    let dir = fsutil::ensure_app_dir(&app)?;
    Ok(view(&dir, save_at(&dir, &provider)?))
}

/// Removes a custom provider, or resets a built-in one, together with its key.
#[tauri::command(async)]
pub fn provider_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = fsutil::ensure_app_dir(&app)?;
    let mut user = user_entries(&dir);
    user.remove(&id);
    write_user_entries(&dir, &user)?;
    set_key(&dir, &id, None).map(|_| ())
}

#[tauri::command(async)]
pub fn provider_set_key(app: AppHandle, id: String, key: Option<String>) -> Result<ProviderView, String> {
    let dir = fsutil::ensure_app_dir(&app)?;
    let provider = find(&dir, &id)?;
    let key = key.map(|key| key.trim().to_string()).filter(|key| !key.is_empty());
    set_key(&dir, &id, key.as_deref())?;
    Ok(view(&dir, provider))
}

/// "Fetch available models": asks the endpoint's model list and saves it.
#[tauri::command]
pub async fn provider_fetch_models(app: AppHandle, state: State<'_, AiState>, id: String) -> Result<ProviderView, String> {
    let dir = fsutil::ensure_app_dir(&app)?;
    let provider = find(&dir, &id)?;
    let key = resolve_key(&dir, &provider).map(|(key, _)| key);
    if key.is_none() && !provider.no_key {
        return Err(format!("Add a {} API key first.", provider.display_name()));
    }
    let mut models = fetch_models(&state.client, &provider, key.as_deref()).await?;
    // Effort levels someone declared by hand survive a refresh.
    for model in &mut models {
        if model.reasoning_efforts.is_none() {
            model.reasoning_efforts = provider.model(&model.id).and_then(|old| old.reasoning_efforts.clone());
        }
    }
    let saved = save_at(&dir, &json!({ "id": id, "models": models }))?;
    Ok(view(&dir, saved))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdeditor-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn catalog_is_valid_and_overridable() {
        let dir = temp("providers");
        let all = load(&dir);
        assert_eq!(all.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["deepseek", "openai", "anthropic", "openrouter", "ollama", "commandcode"]);
        for provider in &all {
            validate(provider).unwrap_or_else(|e| panic!("{}: {e}", provider.id));
            assert!(provider.builtin);
        }

        // A model list saved for a built-in keeps the rest of its catalog entry.
        save_at(&dir, &json!({ "id": "deepseek", "models": [{ "id": "deepseek-flash" }] })).unwrap();
        let deepseek = find(&dir, "deepseek").unwrap();
        assert_eq!(deepseek.base_url, "https://api.deepseek.com");
        assert_eq!(deepseek.compat.thinking_format.as_deref(), Some("deepseek"));
        let model = deepseek.model("deepseek-flash").unwrap();
        assert_eq!(cheapest_effort(deepseek.efforts(model).unwrap()), Some("off"));

        // Custom route, harness-style fields; unknown fields are dropped.
        let saved = save_at(&dir, &json!({
            "id": "my-gateway", "api": OPENAI, "baseURL": "https://gateway.example/v1", "apiKeyEnv": "GATEWAY_API_KEY",
            "hasKey": true, "builtin": true,
            "models": [{ "id": "legacy-chat" }, { "id": "reasoner", "reasoningEfforts": { "off": null, "high": "high" } }],
        })).unwrap();
        assert!(!saved.builtin);
        let text = std::fs::read_to_string(dir.join("providers.json")).unwrap();
        assert!(!text.contains("hasKey") && !text.contains("builtin"), "{text}");
        let gateway = find(&dir, "my-gateway").unwrap();
        assert!(gateway.efforts(gateway.model("legacy-chat").unwrap()).is_none());
        assert_eq!(gateway.efforts(gateway.model("reasoner").unwrap()).unwrap().len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_unsafe_providers() {
        let dir = temp("providers-bad");
        let base = json!({ "id": "x", "api": OPENAI, "baseURL": "https://a.example/v1" });
        let with = |key: &str, value: Value| {
            let mut entry = base.clone();
            entry[key] = value;
            save_at(&dir, &entry)
        };
        assert!(with("id", json!("Bad Id")).is_err());
        assert!(with("id", json!("../x")).is_err());
        assert!(with("api", json!("soap")).is_err());
        assert!(with("baseURL", json!("file:///etc/passwd")).is_err());
        assert!(with("baseURL", json!("http://remote.example/v1")).is_err(), "a key over plain HTTP");
        assert!(with("baseURL", json!("http://127.0.0.1:8080/v1")).is_ok());
        assert!(with("headers", json!({ "X-A": "a\r\nX-B: b" })).is_err());
        let mut lan = base.clone();
        lan["baseURL"] = json!("http://192.168.1.20:11434/v1");
        lan["noKey"] = json!(true);
        assert!(save_at(&dir, &lan).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parses_model_lists() {
        let openai = build("openai", Some(&catalog()[1].1), None).unwrap();
        let models = parse_models(&openai, &json!({ "data": [{ "id": "gpt-x" }, { "id": "text-embedding-3" }, { "id": "" }] }));
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["gpt-x"]);

        let anthropic = build("anthropic", Some(&catalog()[2].1), None).unwrap();
        let on = json!({ "supported": true });
        let off = json!({ "supported": false });
        let models = parse_models(&anthropic, &json!({ "data": [
            { "id": "claude-a", "display_name": "Claude A", "max_input_tokens": 1000000, "max_tokens": 128000,
              "capabilities": { "thinking": { "supported": true, "types": { "adaptive": on, "enabled": off } },
                                "effort": { "supported": true, "low": on, "medium": on, "high": on, "xhigh": off, "max": on } } },
            { "id": "claude-b", "capabilities": { "thinking": { "types": { "adaptive": off } }, "effort": { "supported": false } } },
        ] }));
        assert_eq!(models[0].name.as_deref(), Some("Claude A"));
        assert_eq!((models[0].context_window, models[0].max_tokens), (Some(1_000_000), Some(128_000)));
        assert_eq!(models[0].reasoning_efforts.as_ref().unwrap().keys().collect::<Vec<_>>(), ["high", "low", "max", "medium"]);
        assert!(models[1].reasoning_efforts.is_none());

        let ollama = build("ollama", Some(&catalog()[4].1), None).unwrap();
        assert_eq!(parse_models(&ollama, &json!({ "models": [{ "name": "llama3" }] }))[0].id, "llama3");
    }

    #[test]
    fn file_keys_round_trip_privately() {
        let dir = temp("keys");
        set_file_key(&dir, "openai", Some("sk-test-1234567890")).unwrap();
        assert_eq!(file_keys(&dir).get("openai").and_then(Value::as_str), Some("sk-test-1234567890"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(credentials_path(&dir)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        set_file_key(&dir, "openai", None).unwrap();
        assert!(!credentials_path(&dir).exists(), "an empty key file is removed");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_env_key_variants() {
        let path = std::env::temp_dir().join(format!("mdeditor-env-{}", std::process::id()));
        std::fs::write(&path, "# comment\nOTHER=x\nexport CMD_API_KEY = \"user_abc\"\n").unwrap();
        assert_eq!(read_env_key(&path, "CMD_API_KEY").as_deref(), Some("user_abc"));
        std::fs::write(&path, "CMD_API_KEY=user_plain\r\n").unwrap();
        assert_eq!(read_env_key(&path, "CMD_API_KEY").as_deref(), Some("user_plain"));
        std::fs::write(&path, "CMD_API_KEY=\n").unwrap();
        assert_eq!(read_env_key(&path, "CMD_API_KEY"), None);
        let _ = std::fs::remove_file(path);
    }
}
