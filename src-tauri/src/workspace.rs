//! The folders a window has open: the sidebar tree, the file index for Big Brain, and search.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::Emitter;

// Markdown, plus the formats the app exports and can show in its viewer.
const OPEN_EXTENSIONS: [&str; 6] = ["md", "markdown", "mdx", "pdf", "html", "htm"];
const SKIP_DIRS: [&str; 3] = ["node_modules", "target", "dist"];
const MAX_TEXT_BYTES: u64 = 2_000_000;
// Not worth reading as text. Unknown extensions count as text; a stray binary fails UTF-8 on read.
const BINARY_EXTENSIONS: [&str; 62] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "tif", "tiff", "avif", "heic", "psd",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub",
    "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "deb", "rpm", "appimage", "dmg", "iso",
    "mp3", "wav", "ogg", "flac", "m4a", "mp4", "mkv", "mov", "avi", "webm",
    "ttf", "otf", "woff", "woff2",
    "exe", "dll", "so", "dylib", "a", "o", "bin", "wasm", "class",
];

#[derive(Serialize, Debug)]
pub struct TreeNode {
    name: String,
    path: String,
    children: Option<Vec<TreeNode>>, // None = file
}

fn is_openable(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| OPEN_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

// ponytail: depth 8 / 5000 files cap keeps huge trees responsive; lazy-load per folder if users need more.
fn walk(dir: &Path, depth: usize, budget: &mut usize) -> Vec<TreeNode> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort_by_key(|p| (!p.is_dir(), p.file_name().map(|n| n.to_ascii_lowercase())));
    let mut out = vec![];
    for p in entries {
        if *budget == 0 {
            break;
        }
        let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            if depth == 0 || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let children = walk(&p, depth - 1, budget);
            if !children.is_empty() {
                out.push(TreeNode { name, path: p.to_string_lossy().into_owned(), children: Some(children) });
            }
        } else if is_openable(&p) {
            *budget -= 1;
            out.push(TreeNode { name, path: p.to_string_lossy().into_owned(), children: None });
        }
    }
    out
}

/// Files Big Brain can read as text: everything `.gitignore` does not hide, minus binaries and huge files.
fn text_files(dir: &Path, limit: usize) -> (Vec<String>, bool) {
    let walker = ignore::WalkBuilder::new(dir)
        .require_git(false) // honour .gitignore in folders that are not repositories too
        .max_depth(Some(12))
        .filter_entry(|e| !e.file_type().is_some_and(|t| t.is_dir()) || !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        .sort_by_file_path(|a, b| a.cmp(b))
        .build();
    let mut files = vec![];
    for entry in walker.flatten() {
        let path = entry.path();
        let binary = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| BINARY_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
        if binary || !entry.file_type().is_some_and(|t| t.is_file()) || entry.metadata().map_or(true, |m| m.len() > MAX_TEXT_BYTES) {
            continue;
        }
        if files.len() == limit {
            return (files, true);
        }
        files.push(path.to_string_lossy().into_owned());
    }
    (files, false)
}

/// One workspace folder: the sidebar tree, and every file Big Brain may read.
#[derive(Serialize, Debug)]
pub struct Root {
    path: String,
    /// Files the app can open (Markdown, PDF, HTML), nested; `.gitignore` is not applied.
    tree: Vec<TreeNode>,
    /// Text files, flat. A superset of the tree's Markdown files unless `.gitignore` hides them.
    files: Vec<String>,
    truncated: bool,
}

// ponytail: 20,000 text files per folder; index lazily per subfolder if real workspaces exceed it.
#[tauri::command(async)]
pub fn list_workspace(folders: Vec<String>) -> Vec<Root> {
    folders
        .into_iter()
        .map(|path| {
            let dir = Path::new(&path);
            let (files, truncated) = text_files(dir, 20_000);
            Root { tree: walk(dir, 8, &mut 5000), files, truncated, path }
        })
        .collect()
}

#[derive(Serialize, Debug)]
pub struct Hit {
    path: String,
    line: usize,
    text: String,
}

fn snippet(line: &str, at: usize, len: usize) -> String {
    let start = line[..at].char_indices().rev().nth(40).map_or(0, |(i, _)| i);
    let end = line[at + len..].char_indices().nth(80).map_or(line.len(), |(i, _)| at + len + i);
    let mut s = line[start..end].trim().to_string();
    if start > 0 {
        s.insert(0, '…');
    }
    if end < line.len() {
        s.push('…');
    }
    s
}

#[tauri::command(async)]
pub fn search_files(paths: Vec<String>, query: String) -> Vec<Hit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    let mut hits = vec![];
    let mut seen = HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        if fs::metadata(&path).map_or(true, |m| m.len() > MAX_TEXT_BYTES) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let mut per_file = 0;
        for (i, line) in text.lines().enumerate() {
            let lower = line.to_lowercase();
            // Lowercasing can change byte lengths for some scripts; only slice when lengths agree.
            if let Some(at) = lower.find(&q) {
                let text = if lower.len() == line.len() { snippet(line, at, q.len()) } else { line.trim().to_string() };
                hits.push(Hit { path: path.clone(), line: i + 1, text });
                per_file += 1;
                if per_file == 5 {
                    break;
                }
            }
        }
        if hits.len() >= 200 {
            hits.truncate(200);
            break;
        }
    }
    hits
}

/// One file watcher per window, by window label. Dropping a watcher stops it.
#[derive(Default)]
pub struct Watchers(pub Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>);

/// Build output and VCS internals change constantly and never show in the app.
fn is_noise(path: &Path) -> bool {
    path.components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        SKIP_DIRS.contains(&name.as_ref()) || (name.starts_with('.') && name.len() > 1 && name != "..")
    })
}

/// Watches this window's folders (recursively) and the folders of its loose files, replacing the
/// previous watch. Changes arrive in the window as one debounced `fs-changed` event.
// ponytail: a path that cannot be watched (inotify limit, folder gone) is skipped silently; the
// window still re-checks the disk whenever it regains focus.
#[tauri::command]
pub fn watch_paths(window: tauri::WebviewWindow, watchers: tauri::State<Watchers>, folders: Vec<String>, files: Vec<String>) -> Result<(), String> {
    let label = window.label().to_string();
    let target = window.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |result: DebounceEventResult| {
        let paths: Vec<String> = result
            .unwrap_or_default()
            .into_iter()
            .filter(|event| !is_noise(&event.path))
            .map(|event| event.path.to_string_lossy().into_owned())
            .collect();
        if !paths.is_empty() {
            let _ = target.emit_to(target.label(), "fs-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    for folder in &folders {
        let _ = debouncer.watcher().watch(Path::new(folder), RecursiveMode::Recursive);
    }
    // Editors save by replacing the file, which drops a watch on the file itself: watch its folder.
    let parents: HashSet<&Path> = files.iter().filter_map(|file| Path::new(file).parent()).collect();
    for parent in parents.into_iter().filter(|parent| !folders.iter().any(|folder| parent.starts_with(folder))) {
        let _ = debouncer.watcher().watch(parent, RecursiveMode::NonRecursive);
    }
    watchers.0.lock().unwrap().insert(label, debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_index_and_search() {
        let root = std::env::temp_dir().join(format!("mdviewer-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("docs/Guide.md"), "intro\nThe Quick fox\n").unwrap();
        fs::write(root.join("notes.txt"), "x").unwrap();
        fs::write(root.join("logo.png"), "x").unwrap();
        fs::write(root.join(".gitignore"), "build/\n").unwrap();
        fs::write(root.join("build/out.md"), "x").unwrap();
        fs::write(root.join("node_modules/pkg/readme.md"), "x").unwrap();

        let roots = list_workspace(vec![root.to_string_lossy().into()]);
        let tree = &roots[0].tree;
        // The tree shows what can be opened, ignored or not; the index is what Big Brain reads.
        assert_eq!(tree.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), ["build", "docs"], "{tree:?}");
        let at = |name: &str| root.join(name).to_string_lossy().into_owned();
        assert_eq!(roots[0].files, [at("docs/Guide.md"), at("notes.txt")]);
        assert!(!roots[0].truncated);
        assert!(text_files(&root, 1).1);

        assert!(is_noise(&root.join("node_modules/pkg/readme.md")) && is_noise(&root.join(".git/index")));
        assert!(!is_noise(&root.join("docs/Guide.md")));

        let hits = search_files(vec![at("docs/Guide.md")], "quick".into());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].text, "The Quick fox");
        fs::remove_dir_all(root).unwrap();
    }
}
