use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::Manager;

const APP_DIR: &str = ".markdowneditor";
const OLD_APP_DIR: &str = ".markdown-viewer-app";

/// Where settings, keys, chats and drafts live. Carries over the folder of the
/// app's previous name the first time it is asked for.
pub fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = home.join(APP_DIR);
    let old = home.join(OLD_APP_DIR);
    if !dir.exists() && old.is_dir() {
        let _ = fs::rename(&old, &dir);
    }
    Ok(dir)
}

/// Creates the app folder (owner-only on Unix) and returns it.
pub fn ensure_app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Replaces `path` in one step: a crash or full disk leaves the old file, never a
/// truncated one. Writes through symlinks and keeps the file's permissions;
/// `private` makes it readable by the owner only.
pub fn atomic_write(path: &Path, bytes: &[u8], private: bool) -> io::Result<()> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "not a file path"))?;
    let tmp = dir.join(format!(
        ".{}.{}-{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(bytes)?;
        if !private {
            // A new file gets the usual default; an existing one keeps what it had.
            let permissions = fs::metadata(&target).map(|m| m.permissions()).ok().or_else(default_permissions);
            if let Some(permissions) = permissions {
                file.set_permissions(permissions)?;
            }
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(unix)]
fn default_permissions() -> Option<fs::Permissions> {
    use std::os::unix::fs::PermissionsExt;
    Some(fs::Permissions::from_mode(0o644))
}

#[cfg(not(unix))]
fn default_permissions() -> Option<fs::Permissions> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_whole_file_and_keeps_mode() {
        let dir = std::env::temp_dir().join(format!("mdeditor-atomic-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");

        atomic_write(&file, b"first", false).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "first");
        atomic_write(&file, b"second, longer", false).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second, longer");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
            atomic_write(&file, b"third", false).unwrap();
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o640);

            let secret = dir.join("secret.json");
            atomic_write(&secret, b"{}", true).unwrap();
            assert_eq!(fs::metadata(&secret).unwrap().permissions().mode() & 0o777, 0o600);

            // A symlinked note stays a symlink; its target gets the new text.
            let link = dir.join("link.md");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            atomic_write(&link, b"via link", false).unwrap();
            assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
            assert_eq!(fs::read_to_string(&file).unwrap(), "via link");
        }

        // A failed write leaves no temp file behind and the old text in place.
        assert!(atomic_write(&dir.join("missing").join("x.md"), b"x", false).is_err());
        let leftovers = fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).count();
        assert_eq!(leftovers, 0);
        fs::remove_dir_all(dir).unwrap();
    }
}
