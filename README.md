# Markdown

A calm Markdown viewer and editor for the desktop. Open a file or a whole folder, read
distraction-free, edit with a live preview, and export to PDF — in one small, native app
built with Tauri.

![Markdown showing this README in dark mode](docs/screenshot.png)

## Features

**Reading & editing**
- Three view modes: **Read**, **Split** (source + live preview with scroll sync), and **Edit**
- CommonMark with GitHub-flavored extensions: tables, task lists, strikethrough, autolink,
  footnotes, alerts (NOTE/TIP/IMPORTANT/WARNING/CAUTION), and heading anchors
- YAML front matter shown as a highlighted code block instead of being dropped
- Syntax highlighting for ~200 languages (bat's syntax set), with per-block caching so the
  preview stays fast while you type
- Mermaid diagrams render live in the preview
- Math renders with KaTeX: `$inline$`, `$$display$$`, and ```` ```math ```` blocks
- Find & replace with match case, whole word, and regular expressions (replace one or all)
- Word count and cursor position in the status bar; undo/redo history
- Editor helpers: Enter continues lists, task lists, and quotes; Tab / Shift Tab indent the selected
  lines; typing `*`, `_`, `` ` ``, or a bracket over a selection wraps it; Ctrl B / Ctrl I / Ctrl K
  for bold, italic, and links
- Click a task-list checkbox in the preview to tick it in the source

**Files**
- Sidebar with a folder tree of all Markdown files (`.md`, `.markdown`, `.mdx`)
- Search across file names *and* file contents
- Document outline in the sidebar; click a heading to jump to it
- Command palette (Ctrl Shift P) runs commands, opens files by name, and jumps to headings
- Files changed on disk by another program reload when you return to the window (unsaved edits are kept)
- Recent files on the welcome screen
- Drag-and-drop or dialog to open files/folders; opens as the default app for Markdown files

**Look & feel**
- Frameless, translucent window with custom chrome (minimize / maximize / close)
- Reader-friendly Sage and Plum themes (default, following the system), Paper, Midnight, Sepia, Dusk, E-ink and Forest, plus Light, Dark, Monokai, and Vercel, with an accent color picker
- Configurable interface, document, and editor fonts (picks up the fonts installed on your system)
- Reading width, line spacing, justified text, and code wrapping; editor tab width, autosave, and startup behavior
- Export the current document to PDF

**Mark (AI)**
- Right-side assistant that always sees the open document, including unsaved edits
- Select any text to reveal **Ask Mark**; the selection is attached alongside the full file
- Streaming Markdown answers with an expandable **Thinking** disclosure and an **Actions** trace
- Per-message token usage, plus chat totals and cost when the gateway reports it
- Chats are saved under `~/.markdown-viewer-app/chats`, named by the model, and can be renamed or deleted
- Large documents are sent as an outline; Mark reads and searches the parts it needs, and can search and read the other Markdown files of the open folder
- **About you** notes and a **Memory** of lasting preferences personalize every chat (Settings → Mark)

## Mark (AI)

Mark answers through the [Command Code gateway](https://commandcode.ai/docs/provider) using
**DeepSeek V4.1 Flash** with selectable reasoning effort (Off / Low / High / Max; default High).

Set `CMD_API_KEY` in `.env` for development, or paste a key in **Settings → Mark** (stored in
`~/.markdown-viewer-app/config.json`, mode 0600). The app never exposes the key to the webview:
requests go through the Rust backend, and the document text is sent to Command Code only when you
ask Mark a question.

Chats persist as JSON at `~/.markdown-viewer-app/chats/<date>/<id>.json`, including messages,
reasoning, actions, and token/cost usage. Nothing is sent anywhere else, and stored reasoning is
never replayed to the model.

**Context.** A document up to 60,000 characters is sent whole; a larger one is sent as a heading
outline with line numbers, and Mark fetches ranges with its `read_document` / `search_document`
tools. With a folder open it also gets `list_files`, `search_files`, and `read_file`, limited to
that folder's Markdown files. Long chats are folded into a summary once they pass about 48,000
characters. The prompt is ordered so the gateway's prefix cache keeps hitting between turns.

**Personalization and memory.** Settings → Mark has an **About you** box that is included in every
chat, and a **Memory** switch. With memory on, Mark saves lasting facts and preferences you mention
(you get a toast each time) and you can delete any of them in Settings. Both live in
`~/.markdown-viewer-app/memory.json` (mode 0600) and are sent to Command Code with your questions.

## Download & install (Linux)

Every `v*` tag is built by the [CI pipeline](.gitlab-ci.yml) and published on the
[Releases page](../../releases) — download a package and install it directly, no build required:

- **`Markdown_<version>_amd64.deb`** — Debian, Ubuntu, and derivatives
- **`Markdown_<version>_amd64.AppImage`** — any other distribution with a desktop

```sh
# Debian / Ubuntu: installs the app and pulls in its system dependencies
sudo apt install ./Markdown_<version>_amd64.deb

# AppImage: no installation, just make it executable and run it
chmod +x Markdown_<version>_amd64.AppImage
./Markdown_<version>_amd64.AppImage
```

Both come with a desktop entry and Markdown file associations.

### Build from source

```sh
./install.sh
```

Builds the release binary and installs it for the current user (`~/.local`), registers a
desktop entry, and sets it as the default app for Markdown files.

```sh
./install.sh --reinstall   # rebuild and install fresh
./install.sh --uninstall   # remove it
PREFIX=/usr/local sudo -E ./install.sh   # system-wide
```

System libraries (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, …) are installed automatically on
apt-based distros. See the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
for other distributions.

## Development

Requires [Rust](https://rustup.rs), Node.js, and the Tauri system dependencies for your platform.

```sh
npm ci          # install the Tauri CLI
npm run dev     # run the app in development mode
npm run build   # release build with installers/bundles
```

Tests and checks:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
node --check src/main.js
node src/mdsource.js
```

CI runs the tests on every push and, on a `v*` tag, builds the `.deb` and `.AppImage` and
publishes them on the [Releases page](../../releases).

## Architecture

- `src/` — frontend: plain HTML/CSS/JS (no framework), with Mermaid and KaTeX vendored for diagrams and math
- `src-tauri/` — Rust backend (Tauri 2): Markdown rendering via
  [comrak](https://github.com/kivikakk/comrak), highlighting via syntect (two-face syntax set),
  HTML sanitization via [ammonia](https://github.com/rust-ammonia/ammonia), plus the Command Code
  gateway proxy (streaming SSE, reasoning, usage/cost), chat storage, file tree, search, font
  listing, and PDF printing commands
- `install.sh` — build + Linux desktop integration (desktop file, icons, MIME defaults)
