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
- Find & replace with match case, whole word, and regular expressions (replace one or all)
- Word count and cursor position in the status bar; undo/redo history

**Files**
- Sidebar with a folder tree of all Markdown files (`.md`, `.markdown`, `.mdx`)
- Search across file names *and* file contents
- Recent files on the welcome screen
- Drag-and-drop or dialog to open files/folders; opens as the default app for Markdown files

**Look & feel**
- Frameless, translucent window with custom chrome (minimize / maximize / close)
- Light and dark themes, with an accent color picker
- Configurable interface, document, and editor fonts (picks up the fonts installed on your system)
- Export the current document to PDF

## Download & install (Linux)

Every `v*` tag is built by the [CI pipeline](.github/workflows/ci.yml) and published on the
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
```

CI runs the tests on every push and, on a `v*` tag, builds the `.deb` and `.AppImage` and
publishes them on the [Releases page](../../releases).

## Architecture

- `src/` — frontend: plain HTML/CSS/JS (no framework), with Mermaid vendored for diagrams
- `src-tauri/` — Rust backend (Tauri 2): Markdown rendering via
  [comrak](https://github.com/kivikakk/comrak), highlighting via syntect (two-face syntax set),
  HTML sanitization via [ammonia](https://github.com/rust-ammonia/ammonia), plus file tree,
  search, font listing, and PDF printing commands
- `install.sh` — build + Linux desktop integration (desktop file, icons, MIME defaults)
