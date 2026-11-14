use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Metadata shown in the chat history list. The full chat stays on disk.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub date: String,
    pub title: String,
    pub updated_at: String,
    pub file_name: Option<String>,
    pub message_count: usize,
    pub tokens: u64,
    pub cost: Option<f64>,
}

fn chats_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::fsutil::app_dir(app)?.join("chats"))
}

fn valid_id(id: &str) -> bool {
    (6..=16).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn chat_file(root: &Path, date: &str, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid chat id.".into());
    }
    if !valid_date(date) {
        return Err("Invalid chat date.".into());
    }
    Ok(root.join(date).join(format!("{id}.json")))
}

fn save_at(root: &Path, date: &str, id: &str, json: &str) -> Result<(), String> {
    // Refuse anything that is not a JSON object with an id, so a bug can't write junk.
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("Invalid chat JSON: {e}"))?;
    if !value.is_object() {
        return Err("Invalid chat JSON: expected an object.".into());
    }
    let path = chat_file(root, date, id)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::fsutil::atomic_write(&path, json.as_bytes(), true).map_err(|e| e.to_string())
}

fn load_at(root: &Path, date: &str, id: &str) -> Result<String, String> {
    fs::read_to_string(chat_file(root, date, id)?).map_err(|e| e.to_string())
}

fn usage_numbers(usage: &serde_json::Value) -> Option<(u64, u64, Option<f64>)> {
    if !usage.is_object() {
        return None;
    }
    let input = usage.get("input").and_then(serde_json::Value::as_u64).unwrap_or(0);
    let output = usage.get("output").and_then(serde_json::Value::as_u64).unwrap_or(0);
    let cost = usage.get("cost").and_then(serde_json::Value::as_f64);
    Some((input, output, cost))
}

/// Chat-level totals, falling back to summing message usage for older files.
fn summary_usage(value: &serde_json::Value) -> (u64, u64, Option<f64>) {
    if let Some(totals) = value.get("usage").and_then(usage_numbers) {
        return totals;
    }
    let mut input = 0;
    let mut output = 0;
    let mut cost = None;
    if let Some(messages) = value.get("messages").and_then(serde_json::Value::as_array) {
        for message in messages {
            if let Some((i, o, c)) = message.get("usage").and_then(usage_numbers) {
                input += i;
                output += o;
                if let Some(c) = c {
                    cost = Some(cost.unwrap_or(0.0) + c);
                }
            }
        }
    }
    (input, output, cost)
}

fn list_at(root: &Path) -> Vec<ChatSummary> {
    let Ok(entries) = fs::read_dir(root) else {
        return vec![];
    };
    let mut out = vec![];
    for date_entry in entries.flatten() {
        if !date_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let date = date_entry.file_name().to_string_lossy().into_owned();
        if !valid_date(&date) {
            continue;
        }
        let Ok(files) = fs::read_dir(date_entry.path()) else {
            continue;
        };
        for file in files.flatten() {
            let name = file.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if !valid_id(id) {
                continue;
            }
            let Ok(text) = fs::read_to_string(file.path()) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let (input_tokens, output_tokens, cost) = summary_usage(&value);
            out.push(ChatSummary {
                id: id.to_string(),
                date: date.clone(),
                title: value["title"].as_str().filter(|s| !s.is_empty()).unwrap_or("Untitled chat").to_string(),
                updated_at: value["updatedAt"].as_str().unwrap_or("").to_string(),
                file_name: value["file"]["name"].as_str().map(str::to_owned),
                message_count: value["messages"].as_array().map_or(0, Vec::len),
                tokens: input_tokens + output_tokens,
                cost,
            });
        }
    }
    // ISO-8601 timestamps sort lexicographically, newest first.
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

fn delete_at(root: &Path, date: &str, id: &str) -> Result<(), String> {
    let path = chat_file(root, date, id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // already gone
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command(async)]
pub fn chats_list(app: tauri::AppHandle) -> Vec<ChatSummary> {
    chats_root(&app).map(|root| list_at(&root)).unwrap_or_default()
}

#[tauri::command(async)]
pub fn chat_load(app: tauri::AppHandle, date: String, id: String) -> Result<String, String> {
    load_at(&chats_root(&app)?, &date, &id)
}

#[tauri::command(async)]
pub fn chat_save(app: tauri::AppHandle, date: String, id: String, json: String) -> Result<(), String> {
    save_at(&chats_root(&app)?, &date, &id, &json)
}

#[tauri::command(async)]
pub fn chat_delete(app: tauri::AppHandle, date: String, id: String) -> Result<(), String> {
    delete_at(&chats_root(&app)?, &date, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("mdviewer-chats-{}-{unique}", std::process::id()))
    }

    fn sample(title: &str, updated: &str) -> String {
        format!(
            r#"{{"title":"{title}","updatedAt":"{updated}","file":{{"name":"Notes.md"}},"messages":[{{"role":"user"}},{{"role":"assistant"}}]}}"#
        )
    }

    #[test]
    fn round_trip_and_delete() {
        let root = root();
        let json = sample("First chat", "2026-11-09T10:00:00Z");
        save_at(&root, "2026-11-09", "abcdefgh", &json).unwrap();
        assert_eq!(load_at(&root, "2026-11-09", "abcdefgh").unwrap(), json);

        let listed = list_at(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "First chat");
        assert_eq!(listed[0].file_name.as_deref(), Some("Notes.md"));
        assert_eq!(listed[0].message_count, 2);

        delete_at(&root, "2026-11-09", "abcdefgh").unwrap();
        assert!(load_at(&root, "2026-11-09", "abcdefgh").is_err());
        delete_at(&root, "2026-11-09", "abcdefgh").unwrap(); // idempotent
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_newest_first_and_skips_junk() {
        let root = root();
        save_at(&root, "2026-11-08", "aaaaaaaa", &sample("Older", "2026-11-08T10:00:00Z")).unwrap();
        save_at(&root, "2026-11-09", "bbbbbbbb", &sample("Newer", "2026-11-09T10:00:00Z")).unwrap();
        fs::create_dir_all(root.join("not-a-date")).unwrap();
        fs::write(root.join("2026-11-09").join("bad.json"), "not json").unwrap();

        let listed = list_at(&root);
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].title, "Newer");
        assert_eq!(listed[1].title, "Older");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn summarizes_usage_tokens_and_cost() {
        let chat: serde_json::Value =
            serde_json::from_str(r#"{"usage":{"input":10,"output":5,"cost":0.001}}"#).unwrap();
        assert_eq!(summary_usage(&chat), (10, 5, Some(0.001)));

        let legacy: serde_json::Value = serde_json::from_str(
            r#"{"messages":[{"usage":{"input":2,"output":3,"cost":0.0002}},{"usage":{"input":1,"output":1}}]}"#,
        )
        .unwrap();
        assert_eq!(summary_usage(&legacy), (3, 4, Some(0.0002)));
        assert_eq!(summary_usage(&serde_json::json!({})), (0, 0, None));
    }

    #[test]
    fn rejects_invalid_paths_and_json() {
        let root = root();
        assert!(save_at(&root, "../etc", "abcdefgh", &sample("x", "2026-11-09")).is_err());
        assert!(save_at(&root, "2026-11-09", "../../x", &sample("x", "2026-11-09")).is_err());
        assert!(save_at(&root, "2026-11-09", "short", &sample("x", "2026-11-09")).is_err());
        assert!(save_at(&root, "2026-11-09", "abcdefgh", "[]").is_err());
        assert!(save_at(&root, "2026-11-09", "abcdefgh", "not json").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
