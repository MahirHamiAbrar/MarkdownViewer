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
use tauri::{Emitter, Manager};

mod ai;
mod anthropic;
mod chats;
mod cli;
mod fsutil;
mod gpu;
mod highlights;
mod providers;
mod web_search;
mod workspace;

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
    fsutil::atomic_write(Path::new(&path), contents.as_bytes(), false).map_err(|e| e.to_string())
}

fn draft_file(dir: &Path, id: &str) -> Result<std::path::PathBuf, String> {
    if !(1..=64).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid draft id.".into());
    }
    Ok(dir.join("drafts").join(format!("{id}.json")))
}

/// Unsaved text, kept so a crash or power cut does not lose it: `{ path, text, savedAt }`.
#[tauri::command(async)]
fn draft_save(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    if json.len() > 20_000_000 || !serde_json::from_str::<serde_json::Value>(&json).is_ok_and(|v| v.is_object()) {
        return Err("Invalid draft.".into());
    }
    let file = draft_file(&fsutil::ensure_app_dir(&app)?, &id)?;
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    fsutil::atomic_write(&file, json.as_bytes(), true).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn draft_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    match fs::remove_file(draft_file(&fsutil::app_dir(&app)?, &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Every draft left behind, as `[id, json]` pairs.
#[tauri::command(async)]
fn drafts_list(app: tauri::AppHandle) -> Vec<(String, String)> {
    let Ok(dir) = fsutil::app_dir(&app) else { return vec![] };
    let Ok(entries) = fs::read_dir(dir.join("drafts")) else { return vec![] };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| Some((p.file_stem()?.to_str()?.to_owned(), fs::read_to_string(&p).ok()?)))
        .collect()
}

/// Open requests waiting for their window's frontend to boot, by window label.
#[derive(Default)]
struct PendingOpens(Mutex<HashMap<String, cli::OpenRequest>>);

/// Label of the window focused last: where a file opened from the terminal goes.
struct LastFocused(Mutex<String>);

/// What this window was launched to open, handed over once.
#[tauri::command]
fn initial_open(window: tauri::WebviewWindow, pending: tauri::State<PendingOpens>) -> Option<cli::OpenRequest> {
    pending.0.lock().unwrap().remove(window.label())
}

/// Sorts dropped paths into files and folders.
#[tauri::command(async)]
fn classify_paths(paths: Vec<String>) -> cli::OpenRequest {
    // "--" first: a dropped path is never an option.
    cli::parse(std::iter::once("--".to_string()).chain(paths), Path::new("/")).unwrap_or_default()
}

/// Routes a launch to a window: its own for folders and `-n`, otherwise the one used last.
fn dispatch(app: &tauri::AppHandle, req: cli::OpenRequest) {
    let windows = app.webview_windows();
    let last = app.state::<LastFocused>().0.lock().unwrap().clone();
    let target = if req.wants_window() { None } else { windows.get(&last).or_else(|| windows.values().next()) };
    match target {
        Some(window) => {
            let _ = app.emit_to(window.label(), "open-request", &req);
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        None => {
            if let Err(err) = open_window(app, Some(req)) {
                eprintln!("markdowneditor: {err}");
            }
        }
    }
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Whether the updater can replace this install in place. On Linux only the AppImage can;
/// a .deb or install.sh copy belongs to the package manager / user and gets a download link instead.
#[tauri::command]
fn update_supported() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Raw bytes for the PDF viewer, sent without JSON encoding.
#[tauri::command(async)]
fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Writes the page straight to a PDF at `path`, no print dialog. Resolves once the file is complete.
#[cfg(target_os = "linux")]
#[tauri::command]
async fn export_pdf(webview: tauri::Webview, path: String) -> Result<bool, String> {
    use webkit2gtk::PrintOperationExt;

    let uri = gtk::glib::filename_to_uri(&path, None).map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    webview
        .with_webview(move |w| {
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
            let op = webkit2gtk::PrintOperation::new(&w.inner());
            op.set_print_settings(&settings);
            // `failed` is followed by `finished`; the receiver keeps the first message.
            let failed = tx.clone();
            op.connect_failed(move |_, e| drop(failed.send(Err(e.to_string()))));
            op.connect_finished(move |_| drop(tx.send(Ok(()))));
            op.print();
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
        .map(|()| true)
}

// ponytail: Windows and macOS still go through the system print dialog (returns false);
// use WebView2 PrintToPdf / WKWebView createPDF when those platforms get release builds.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
async fn export_pdf(webview: tauri::Webview, path: String) -> Result<bool, String> {
    let _ = path;
    webview.print().map(|()| false).map_err(|e| e.to_string())
}

/// Opens another window alongside the current ones, blank or showing `req`. `?fresh=1` stops
/// the frontend from restoring the last session in it.
fn open_window(app: &tauri::AppHandle, req: Option<cli::OpenRequest>) -> Result<(), String> {
    let windows = app.webview_windows();
    let label = (2..).map(|n| format!("main-{n}")).find(|l| !windows.contains_key(l)).unwrap();
    if let Some(req) = req {
        app.state::<PendingOpens>().0.lock().unwrap().insert(label.clone(), req);
    }
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html?fresh=1".into()))
        .title("MarkdownEditor")
        .inner_size(1180., 780.)
        .min_inner_size(640., 420.)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    open_window(&app, None)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    gpu::apply_env(); // before any thread or webview starts
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        return println!("{}", cli::HELP);
    }
    if args.iter().any(|a| a == "-v" || a == "--version") {
        return println!("markdowneditor {}", env!("CARGO_PKG_VERSION"));
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let request = cli::parse(args, &cwd).unwrap_or_else(|err| {
        eprintln!("markdowneditor: {err}\n\n{}", cli::HELP);
        std::process::exit(2);
    });

    let mut builder = tauri::Builder::default();
    // ponytail: --wait runs as its own process and ends with its window, so the caller blocks on
    // the whole window rather than one tab; signal tab-close back to a waiting launcher if needed.
    if !request.wait {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // A later launch hands its arguments to this process and exits.
            let req = cli::parse(args.into_iter().skip(1), Path::new(&cwd)).unwrap_or_default();
            dispatch(app, req);
        }));
    }
    builder
        .manage(PendingOpens(Mutex::new(HashMap::from([("main".to_string(), request)]))))
        .manage(LastFocused(Mutex::new("main".into())))
        .manage(workspace::Watchers::default())
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Focused(true) => *window.state::<LastFocused>().0.lock().unwrap() = window.label().to_string(),
                tauri::WindowEvent::Destroyed => drop(window.state::<workspace::Watchers>().0.lock().unwrap().remove(window.label())),
                _ => {}
            }
        })
        .setup(|app| {
            // Load syntect's syntaxes before the first document arrives.
            std::thread::spawn(|| render_markdown("```rust\nfn main() {}\n```".into()));
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(dir) = fsutil::app_dir(&handle) {
                    providers::migrate_legacy_key(&dir);
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            render_markdown,
            read_file,
            write_file,
            initial_open,
            classify_paths,
            app_version,
            update_supported,
            read_bytes,
            export_pdf,
            new_window,
            gpu::gpu_status,
            gpu::gpu_set,
            workspace::list_workspace,
            workspace::search_files,
            workspace::watch_paths,
            list_fonts,
            ai::ai_chat,
            ai::ai_cancel,
            ai::ai_complete,
            ai::memory_load,
            ai::memory_save,
            providers::providers_list,
            providers::provider_save,
            providers::provider_delete,
            providers::provider_set_key,
            providers::provider_fetch_models,
            draft_save,
            draft_delete,
            drafts_list,
            chats::chats_list,
            chats::chat_load,
            chats::chat_save,
            chats::chat_delete,
            highlights::highlights_load,
            highlights::highlights_save,
            web_search::search_status,
            web_search::set_search_config,
            web_search::set_search_direct,
            web_search::web_search_run
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
}
