//! Command-line arguments: `markdowneditor [options] [path[:line]]...`

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const HELP: &str = "\
Usage: markdowneditor [options] [path[:line]]...

Opens files and folders. A folder becomes the workspace of a new window; a file
opens in the window used last.

Options:
  -n, --new-window  Open in a new window
  -a, --add         Add folders to the window used last instead of a new one
  -w, --wait        Run as a separate process that exits when its window closes
                    (for $EDITOR and git)
  -h, --help        Show this help
  -v, --version     Show the version";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileArg {
    pub path: String,
    /// 1-based line to show, from `path:line`.
    pub line: Option<usize>,
    /// The file does not exist yet: it is created on first save.
    pub new: bool,
}

/// What one launch (or one drop onto a window) asks the app to open.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub files: Vec<FileArg>,
    pub folders: Vec<String>,
    pub new_window: bool,
    pub add: bool,
    pub wait: bool,
}

impl OpenRequest {
    /// Whether this launch gets a window of its own rather than joining an open one.
    pub fn wants_window(&self) -> bool {
        self.new_window || (!self.folders.is_empty() && !self.add)
    }
}

fn absolute(path: &Path) -> String {
    // A file that does not exist yet still gets a clean path when its folder does.
    let resolved = fs::canonicalize(path).ok().or_else(|| {
        Some(fs::canonicalize(path.parent()?).ok()?.join(path.file_name()?))
    });
    resolved.unwrap_or_else(|| path.to_path_buf()).to_string_lossy().into_owned()
}

/// `args` excludes the program name. Relative paths resolve against `cwd`.
pub fn parse(args: impl IntoIterator<Item = String>, cwd: &Path) -> Result<OpenRequest, String> {
    let mut req = OpenRequest::default();
    let mut flags = true;
    for arg in args {
        if flags && arg.starts_with('-') && arg.len() > 1 {
            match arg.as_str() {
                "--" => flags = false,
                "-n" | "--new-window" => req.new_window = true,
                "-a" | "--add" => req.add = true,
                "-w" | "--wait" => req.wait = true,
                _ => return Err(format!("Unknown option “{arg}”.")),
            }
            continue;
        }
        if arg.is_empty() {
            continue;
        }
        let mut path: PathBuf = cwd.join(&arg);
        let mut line = None;
        // `notes.md:42` is a line number only when no file is literally named that.
        if !path.exists() {
            if let Some((head, tail)) = arg.rsplit_once(':') {
                if let (false, Ok(n)) = (head.is_empty(), tail.parse::<usize>()) {
                    path = cwd.join(head);
                    line = Some(n.max(1));
                }
            }
        }
        if path.is_dir() {
            req.folders.push(absolute(&path));
        } else {
            req.files.push(FileArg { new: !path.exists(), path: absolute(&path), line });
        }
    }
    Ok(req)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_paths_lines_and_flags() {
        let dir = std::env::temp_dir().join(format!("mde-cli-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("a.md"), "x").unwrap();
        fs::write(dir.join("odd:7"), "x").unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        let at = |name: &str| root.join(name).to_string_lossy().into_owned();
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        let req = parse(args(&["-n", "a.md:42", "docs", "new.md", "odd:7", "a.md:0"]), &dir).unwrap();
        assert!(req.new_window && !req.add && !req.wait);
        assert_eq!(req.folders, vec![at("docs")]);
        assert_eq!(
            req.files,
            vec![
                FileArg { path: at("a.md"), line: Some(42), new: false },
                FileArg { path: at("new.md"), line: None, new: true },
                FileArg { path: at("odd:7"), line: None, new: false },
                FileArg { path: at("a.md"), line: Some(1), new: false },
            ]
        );
        assert!(req.wants_window());

        // Absolute paths ignore the working directory; `--` ends the options.
        let req = parse(args(&["--", "-a", &at("a.md")]), Path::new("/")).unwrap();
        assert_eq!(req.files.len(), 2);
        assert!(!req.add && req.files[0].new);
        assert!(!req.wants_window());

        assert!(parse(args(&["-a", "docs"]), &dir).is_ok_and(|r| !r.wants_window()));
        assert!(parse(args(&["--bogus"]), &dir).is_err());
        assert_eq!(parse(args(&[]), &dir).unwrap(), OpenRequest::default());
        fs::remove_dir_all(&dir).unwrap();
    }
}
