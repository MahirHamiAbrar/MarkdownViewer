use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use comrak::adapters::SyntaxHighlighterAdapter;
use comrak::plugins::syntect::{SyntectAdapter, SyntectAdapterBuilder};
use comrak::options::Plugins;
use comrak::{markdown_to_html_with_plugins, Options};
use serde::Serialize;
use tauri::Manager;

mod ai;
mod chats;

/// Syntect is the slowest step of a render; the preview re-renders on every edit, so
/// unchanged code blocks reuse their highlighted HTML.
struct CachedHighlighter {
    inner: SyntectAdapter,
    cache: Mutex<HashMap<(Option<String>, String), String>>,
}

impl SyntaxHighlighterAdapter for CachedHighlighter {
    fn write_highlighted(&self, output: &mut dyn fmt::Write, lang: Option<&str>, code: &str) -> fmt::Result {
        // "ts#index.ts" names a file after the language; "c#" and "f#" keep their '#'.
        let lang = lang.map(|l| l.split_once('#').filter(|(_, file)| !file.is_empty()).map_or(l, |(l, _)| l));
        let key = (lang.map(str::to_owned), code.to_owned());
        if let Some(html) = self.cache.lock().unwrap().get(&key) {
            return output.write_str(html);
        }
        let mut html = String::new();
        self.inner.write_highlighted(&mut html, lang, code)?;
        let mut cache = self.cache.lock().unwrap();
        // ponytail: typing inside a block adds an entry per keystroke; wholesale clear, LRU if it ever matters.
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(key, html.clone());
        output.write_str(&html)
    }

    fn write_pre_tag(&self, output: &mut dyn fmt::Write, attributes: HashMap<&'static str, Cow<'_, str>>) -> fmt::Result {
        self.inner.write_pre_tag(output, attributes)
    }

    fn write_code_tag(&self, output: &mut dyn fmt::Write, attributes: HashMap<&'static str, Cow<'_, str>>) -> fmt::Result {
        self.inner.write_code_tag(output, attributes)
    }
}

static HIGHLIGHTER: LazyLock<CachedHighlighter> = LazyLock::new(|| CachedHighlighter {
    // bat's syntax set (two-face): ~200 languages vs syntect's ~75 defaults (adds CMake, TypeScript, TOML, Dockerfile, Kotlin, Swift, Zig…).
    inner: SyntectAdapterBuilder::new().css().syntax_set(two_face::syntax::extra_newlines()).build(),
    cache: Mutex::default(),
});

static SANITIZER: LazyLock<ammonia::Builder<'static>> = LazyLock::new(|| {
    let mut b = ammonia::Builder::default();
    b.add_generic_attributes(["id", "class", "align", "title"])
        .add_tags(["input"])
        .add_tag_attributes("input", ["type", "checked", "disabled"])
        .add_tag_attributes("a", ["aria-label", "data-heading-content"])
        .add_tag_attributes("img", ["width", "height"])
        // Math from comrak's `math_dollars`/`math_code`; KaTeX renders it in the frontend.
        .add_tag_attributes("span", ["data-math-style"])
        .add_tag_attributes("code", ["data-math-style"])
        .link_rel(None);
    b
});

const MD_EXTENSIONS: [&str; 3] = ["md", "markdown", "mdx"];
const SKIP_DIRS: [&str; 3] = ["node_modules", "target", "dist"];

fn options() -> Options<'static> {
    let mut o = Options::default();
    o.extension.strikethrough = true;
    o.extension.table = true;
    o.extension.autolink = true;
    o.extension.tasklist = true;
    o.extension.footnotes = true;
    o.extension.alerts = true;
    o.extension.math_dollars = true; // $inline$ and $$display$$
    o.extension.math_code = true; // $`inline`$ and ```math blocks
    o.extension.header_id_prefix = Some(String::new());
    // Raw HTML is allowed through comrak and then sanitized by ammonia.
    o.render.r#unsafe = true;
    o
}

/// Shows YAML front matter as a highlighted code block instead of silently dropping it.
fn front_matter_as_code(src: &str) -> Cow<'_, str> {
    let Some(rest) = src.strip_prefix("---\n").or_else(|| src.strip_prefix("---\r\n")) else { return src.into() };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let yaml = &rest[..offset];
            let longest = yaml.split(|c| c != '`').map(str::len).max().unwrap_or(0);
            let fence = "`".repeat(longest.max(2) + 1);
            return format!("<div class=\"front-matter\">\n\n{fence}yaml\n{yaml}{fence}\n\n</div>\n\n{}", &rest[offset + line.len()..])
                .into();
        }
        offset += line.len();
    }
    src.into()
}

// Heavy commands run off the main thread (`async`) so the window never stalls on them.
#[tauri::command(async)]
fn render_markdown(src: String) -> String {
    let mut plugins = Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(&*HIGHLIGHTER);
    let html = markdown_to_html_with_plugins(&front_matter_as_code(&src), &options(), &plugins);
    SANITIZER.clean(&html).to_string()
}

#[tauri::command(async)]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn initial_file() -> Option<String> {
    let arg = std::env::args().nth(1)?;
    fs::canonicalize(arg).ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn print_page(webview: tauri::Webview) -> Result<(), String> {
    webview.print().map_err(|e| e.to_string())
}

/// Opens another blank window alongside the current one. `?fresh=1` stops the
/// frontend from restoring the last file or the CLI-argument file in it.
#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    let windows = app.webview_windows();
    let label = (2..).map(|n| format!("main-{n}")).find(|l| !windows.contains_key(l)).unwrap();
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("index.html?fresh=1".into()))
        .title("Markdown")
        .inner_size(1180., 780.)
        .min_inner_size(640., 420.)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn font_families(fc_list: &str) -> Vec<String> {
    let set: HashSet<&str> = fc_list.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let mut out: Vec<String> = set.into_iter().map(str::to_owned).collect();
    out.sort_by_key(|f| f.to_lowercase());
    out
}

// ponytail: fontconfig only (Linux); elsewhere the list is empty and a name can still be typed.
#[tauri::command(async)]
fn list_fonts() -> Vec<String> {
    std::process::Command::new("fc-list")
        .arg("--format=%{family[0]}\n")
        .output()
        .map(|o| font_families(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[derive(Serialize, Debug)]
struct TreeNode {
    name: String,
    path: String,
    children: Option<Vec<TreeNode>>, // None = file
}

fn is_markdown(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MD_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
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
        } else if is_markdown(&p) {
            *budget -= 1;
            out.push(TreeNode { name, path: p.to_string_lossy().into_owned(), children: None });
        }
    }
    out
}

#[tauri::command(async)]
fn list_markdown(dir: String) -> Vec<TreeNode> {
    walk(Path::new(&dir), 8, &mut 5000)
}

#[derive(Serialize, Debug)]
struct Hit {
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
fn search_files(paths: Vec<String>, query: String) -> Vec<Hit> {
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
        if fs::metadata(&path).map_or(true, |m| m.len() > 2_000_000) {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_| {
            // Load syntect's syntaxes before the first document arrives.
            std::thread::spawn(|| render_markdown("```rust\nfn main() {}\n```".into()));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            render_markdown,
            read_file,
            write_file,
            initial_file,
            app_version,
            print_page,
            new_window,
            list_markdown,
            search_files,
            list_fonts,
            ai::ai_chat,
            ai::ai_cancel,
            ai::ai_title,
            ai::ai_status,
            ai::ai_set_key,
            chats::chats_list,
            chats::chat_load,
            chats::chat_save,
            chats::chat_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_safely() {
        let html = render_markdown(
            "# Hello World\n\n- [x] done\n\n```rust\nfn main() {}\n```\n\n<script>alert(1)</script>\n<details><summary>s</summary>x</details>".into(),
        );
        assert!(html.contains(r#"id="hello-world""#), "{html}");
        assert!(html.contains("<input"), "{html}");
        assert!(html.contains("<span class="), "{html}");
        assert!(!html.contains("<script"), "{html}");
        assert!(html.contains("<details>"), "{html}");

        for (lang, code) in [("cpp", "int x = 1;"), ("c", "int x = 1;"), ("go", "func f() {}"), ("cmake", "set(X 1)"), ("ts", "let x: number = 1"), ("toml", "a = 1"), ("ts#index.ts", "let x = 1"), ("c#", "class A {}")] {
            let html = render_markdown(format!("```{lang}\n{code}\n```"));
            assert!(html.contains("<span class=\"source"), "{lang} not highlighted: {html}");
        }

        let fm = render_markdown("---\nname: x\n---\n# Body".into());
        let math = render_markdown("$a^2$ and $$\\sum x$$ and $5 or $6\n\n```math\nx\n```".into());
        assert!(math.contains(r#"<span data-math-style="inline">a^2</span>"#), "{math}");
        assert!(math.contains(r#"<span data-math-style="display">\sum x</span>"#), "{math}");
        assert!(math.contains(r#"class="language-math" data-math-style="display""#), "{math}");
        assert!(math.contains("$5 or $6"), "prices stay text: {math}");

        assert!(fm.contains("name") && fm.contains("language-yaml") && fm.contains("front-matter") && fm.contains(r#"id="body""#), "{fm}");
    }

    #[test]
    fn fonts_sorted_unique() {
        assert_eq!(font_families("Noto Sans\ninter\n\nNoto Sans\nArial\n"), ["Arial", "inter", "Noto Sans"]);
        let html = render_markdown("```rust\nfn a() {}\n```".into());
        assert_eq!(html, render_markdown("```rust\nfn a() {}\n```".into()), "cached highlight matches");
    }

    #[test]
    fn tree_and_search() {
        let root = std::env::temp_dir().join(format!("mdviewer-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::write(root.join("docs/Guide.md"), "intro\nThe Quick fox\n").unwrap();
        fs::write(root.join("notes.txt"), "x").unwrap();

        let tree = list_markdown(root.to_string_lossy().into());
        assert_eq!(tree.len(), 1, "{tree:?}");
        assert_eq!(tree[0].name, "docs");

        let file = root.join("docs/Guide.md").to_string_lossy().into_owned();
        let hits = search_files(vec![file], "quick".into());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].text, "The Quick fox");
        fs::remove_dir_all(root).unwrap();
    }
}
