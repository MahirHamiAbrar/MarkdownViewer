use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// Highlight files are keyed by the absolute document path, so a document keeps its
/// annotations wherever it moves to as long as the path is unchanged.
fn highlights_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::fsutil::app_dir(app)?.join("highlights"))
}

fn highlight_file(root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Invalid document path.".into());
    }
    // Base64 alone can exceed the 255-byte filename limit on long paths. Keep a readable
    // prefix for debugging and append a stable 64-bit FNV-1a hash for uniqueness.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let encoded = URL_SAFE_NO_PAD.encode(path.as_bytes());
    let prefix: String = encoded.chars().take(120).collect();
    Ok(root.join(format!("{prefix}-{hash:016x}.json")))
}

fn load_at(root: &Path, path: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(highlight_file(root, path)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn save_at(root: &Path, path: &str, json: &str) -> Result<(), String> {
    // Refuse anything that is not a JSON object, so a bug can't write junk.
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Invalid highlights JSON: {e}"))?;
    if !value.is_object() {
        return Err("Invalid highlights JSON: expected an object.".into());
    }
    let file = highlight_file(root, path)?;
    let dir = file.parent().ok_or("Invalid highlights path.")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::fsutil::atomic_write(&file, json.as_bytes(), true).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn highlights_load(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    load_at(&highlights_root(&app)?, &path)
}

#[tauri::command(async)]
pub fn highlights_save(app: tauri::AppHandle, path: String, json: String) -> Result<(), String> {
    save_at(&highlights_root(&app)?, &path, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("mdviewer-highlights-{}-{unique}", std::process::id()))
    }

    const SAMPLE: &str = r#"{"version":1,"path":"/docs/Notes.md","highlights":[{"id":"abcdefgh","quote":"hello","start":0,"chats":[]}]}"#;

    #[test]
    fn round_trip_and_absent() {
        let root = root();
        assert_eq!(load_at(&root, "/docs/Notes.md").unwrap(), None);
        save_at(&root, "/docs/Notes.md", SAMPLE).unwrap();
        assert_eq!(load_at(&root, "/docs/Notes.md").unwrap().as_deref(), Some(SAMPLE));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn paths_with_separators_and_unicode_stay_single_files() {
        let root = root();
        let one = "/home/user/Documents/Σημειώσεις/My Notes.md";
        let two = "/home/user/Documents/Other.md";
        save_at(&root, one, SAMPLE).unwrap();
        save_at(&root, two, SAMPLE).unwrap();
        assert_eq!(load_at(&root, one).unwrap().as_deref(), Some(SAMPLE));
        assert_eq!(load_at(&root, two).unwrap().as_deref(), Some(SAMPLE));
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn long_paths_keep_filenames_bounded() {
        let root = root();
        let path = format!("/{}/Notes.md", "a".repeat(1200));
        save_at(&root, &path, SAMPLE).unwrap();
        let entries: Vec<_> = fs::read_dir(&root).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1);
        let name = entries[0].file_name().to_string_lossy().into_owned();
        assert!(name.len() <= 142, "filename was {} bytes", name.len());
        assert_eq!(load_at(&root, &path).unwrap().as_deref(), Some(SAMPLE));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_input() {
        let root = root();
        assert!(save_at(&root, "", SAMPLE).is_err());
        assert!(save_at(&root, "   ", SAMPLE).is_err());
        assert!(save_at(&root, "/docs/Notes.md", "[]").is_err());
        assert!(save_at(&root, "/docs/Notes.md", "not json").is_err());
        assert!(load_at(&root, "").is_err());
    }
}
