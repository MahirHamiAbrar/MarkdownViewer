# MarkdownEditor

A calm Markdown viewer and editor for the desktop. Open a file or a whole folder, read
distraction-free, edit with a live preview, and export to PDF — in one small, native app
built with Tauri.

![MarkdownEditor showing this README in dark mode](docs/screenshot.png)

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
- Saves are atomic, and unsaved text is recovered after a crash
- Export the current document to PDF (Ctrl P) or to a self-contained HTML page (Ctrl Shift E); the app writes the file itself, no print dialog
- Opens PDF and HTML files in a built-in viewer (PDFs through bundled pdf.js)

**Big Brain (AI)**
- Right-side assistant that always sees the open document, including unsaved edits
- Works with DeepSeek, OpenAI, Anthropic, OpenRouter, a local Ollama, or any OpenAI- or Anthropic-compatible endpoint
- Select any text to reveal **Ask Big Brain**; the selection is attached alongside the full file
- Streaming Markdown answers with an expandable **Thinking** disclosure and an **Actions** trace
- Private web search through Google, Bing, DuckDuckGo, Mojeek or SearXNG, with retries, proxy/Tor routing and provider fallback
- Per-message token usage, plus chat totals and cost when the gateway reports it
- Chats are saved under `~/.markdowneditor/chats`, named by the model, and can be renamed or deleted
- Large documents are sent as an outline; Big Brain reads and searches the parts it needs, and can search and read the other Markdown files of the open folder
- **About you** notes and a **Memory** of lasting preferences personalize every chat (Settings → Big Brain)

## Big Brain (AI)

Big Brain answers through a model provider you choose. Nothing is configured out of the box, and
the document text is sent to that provider only when you ask Big Brain a question. With a local
provider such as Ollama, nothing leaves your computer.

### Adding a provider

**Settings → Big Brain → Add model provider.**

- **Third-party model provider**: pick DeepSeek, OpenAI, Anthropic, OpenRouter, Ollama, or
  Command Code and paste its API key (Ollama needs none). The model list is fetched from the
  provider.
- **Custom model API**: for any other endpoint. Enter a lowercase **Provider ID** (permanent:
  chats and saved keys refer to it), the base URL, the API protocol (`openai-completions` or
  `anthropic-messages`), a key, and model ids, or leave the models empty to fetch them.

### Private web search

Big Brain can call a `web_search` tool when an answer needs current information. Toggle it from the
model menu in Big Brain's header. Searches are **proxy-only by default**: without an explicit proxy,
Big Brain tries Tor at `socks5h://127.0.0.1:9050`; if Tor is not running, search fails instead of
falling back to your real IP. Direct search is opt-in from **Settings → Big Brain** and is clearly
marked as non-private.

Providers are tried in order, with retries and proxy/user-agent rotation. CAPTCHA, consent and
JS-challenge pages are detected and skipped. Search queries and snippets are sent to
the selected model provider as part of the model request; the search engine only sees the proxy/Tor route.

Search settings live in `~/.markdown-viewer-app/config.json`:

```json
{
  "search": {
    "enabled": true,
    "providers": ["google", "bing", "duckduckgo", "mojeek", "searx"],
    "searxUrl": "http://127.0.0.1:8080",
    "proxy": "socks5h://127.0.0.1:9050",
    "proxies": [],
    "allowDirect": false,
    "useTor": true,
    "retries": 1,
    "maxResults": 5,
    "timeoutMs": 8000,
    "totalTimeoutMs": 30000
  }
}
```

- `proxy` / `proxies` — HTTP(S) or SOCKS proxies; multiple proxies rotate between retries.
  Prefer `socks5h://` so DNS is resolved by the proxy/Tor, not locally.
- `allowDirect` — when no proxy is configured, use a direct connection (reveals your IP).
- `useTor` — fall back to `socks5h://127.0.0.1:9050` when no proxy is configured and direct is off.
- `providers` — any order of `google`, `bing`, `duckduckgo`, `mojeek`, `searx`.
  `searx` requires `searxUrl`; a self-hosted instance is the most reliable private option.
- `retries` — extra attempts per provider (capped at 3); each retry rotates the proxy and user agent.

## Download & install (Linux)

Pick the model, and its reasoning effort where it has one, from the menu in Big Brain's header. The
choice becomes the default for new chats; each chat remembers its own.

### API keys

Keys are stored in the operating system's keychain (Secret Service on Linux, Keychain on macOS,
Credential Manager on Windows). If no keychain is running, the key goes to
`~/.markdowneditor/credentials.json`, readable by you only, and Settings says so. The webview
never receives a key, only whether one exists and its last four characters. Requests are made by
the Rust backend. An environment variable (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CMD_API_KEY`) overrides the stored key for one run.

### providers.json

The same settings live in `~/.markdowneditor/providers.json` and can be edited by hand. Fields
follow [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness): `api`, `baseURL`,
`apiKeyEnv`, `reasoning` (default effort), `headers`, `compat`, and `models`. A model may declare
its own effort levels; a model with none shows no effort menu.

```json
{
  "providers": {
    "my-gateway": {
      "api": "openai-completions",
      "baseURL": "https://gateway.example/v1",
      "apiKeyEnv": "GATEWAY_API_KEY",
      "models": [
        { "id": "legacy-chat" },
        { "id": "my-reasoner", "reasoningEfforts": { "off": null, "high": "high", "max": "max" } }
      ]
    }
  }
}
```

An entry for a built-in id (`deepseek`, `openai`, `anthropic`, `openrouter`, `ollama`,
`commandcode`) overrides that provider field by field. `compat` switches: `maxTokensField`,
`thinkingFormat: "deepseek"`, `reasoningFormat: "openrouter"`, `toolChoice: false`.

Chats persist as JSON at `~/.markdowneditor/chats/<date>/<id>.json`, including messages,
reasoning, actions, and token/cost usage. Stored reasoning is never replayed to the model.

**Context.** A document up to 60,000 characters is sent whole; a larger one is sent as a heading
outline with line numbers, and Big Brain fetches ranges with its `read_document` / `search_document`
tools. With a folder open it also gets `list_files`, `search_files`, and `read_file`, limited to
that folder's Markdown files. Long chats are folded into a summary once they pass about 48,000
characters. The prompt is ordered so the provider's prefix cache keeps hitting between turns.

**Personalization and memory.** Settings → Big Brain has an **About you** box that is included in every
chat, and a **Memory** switch. With memory on, Big Brain saves lasting facts and preferences you mention
(you get a toast each time) and you can delete any of them in Settings. Both live in
`~/.markdowneditor/memory.json` (mode 0600) and are sent to the selected provider with your questions.

## Download & install

### One command

```sh
# Linux and macOS
curl -fsSL https://raw.githubusercontent.com/MahirHamiAbrar/MarkdownViewer/main/scripts/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/MahirHamiAbrar/MarkdownViewer/main/scripts/install.ps1 | iex
```

Each installs the latest release and checks it against the release's `SHA256SUMS`. On Debian
and Ubuntu it installs the `.deb` with apt (asks for sudo); on other Linux distributions it puts
the AppImage in `~/.local/bin` with a desktop entry; on macOS it copies the app to
`/Applications`; on Windows it runs the installer for the current user.

### Manual download

Download the latest package from the
[Releases page](https://github.com/MahirHamiAbrar/MarkdownViewer/releases/latest); no build
required:

- **`MarkdownEditor_<version>_amd64.deb`** — Debian, Ubuntu, and derivatives
- **`MarkdownEditor_<version>_amd64.AppImage`** — any other distribution with a desktop
- **`MarkdownEditor_<version>_universal.dmg`** — macOS (Apple silicon and Intel)
- **`MarkdownEditor_<version>_x64-setup.exe`** or **`_x64_en-US.msi`** — Windows

The macOS and Windows builds are not code-signed yet. On macOS, right-click the app and choose
**Open** the first time; on Windows, choose **More info → Run anyway** in SmartScreen.

```sh
# Debian / Ubuntu: installs the app and pulls in its system dependencies
sudo apt install ./MarkdownEditor_<version>_amd64.deb

# AppImage: no installation, just make it executable and run it
chmod +x MarkdownEditor_<version>_amd64.AppImage
./MarkdownEditor_<version>_amd64.AppImage
```

Both come with a desktop entry and Markdown file associations. See
[From the terminal](#from-the-terminal) for the `markdowneditor` command.

### Verify your download

Every release file is signed, and the release carries a signed `SHA256SUMS`.

```sh
# 1. Import the project's public key (once)
curl -fsSL https://raw.githubusercontent.com/MahirHamiAbrar/MarkdownViewer/main/docs/signing-key.asc | gpg --import

# 2. Check the checksum list, then the file against it
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

With the [GitHub CLI](https://cli.github.com) you can also confirm a file was built by this
repository's release workflow:

```sh
gh attestation verify MarkdownEditor_<version>_amd64.deb --repo MahirHamiAbrar/MarkdownViewer
```

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

## From the terminal

```sh
markdowneditor notes.md        # open a file (in the window used last, if the app is running)
markdowneditor notes.md:42     # ... at line 42
markdowneditor docs/           # open a folder in a new window
markdowneditor -n notes.md     # force a new window
markdowneditor -a docs/        # add the folder to the window used last
EDITOR="markdowneditor --wait" git commit   # block until the window closes
```

`mde` is a short alias, installed by the `.deb` and by `install.sh`. A path that does not exist
yet opens as a new document and is created on first save. `markdowneditor --help` lists every
option.

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

CI ([`.github/workflows`](.github/workflows)) runs the tests on every push and pull request.
A `v*` tag builds, signs and publishes the `.deb` and `.AppImage`. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get involved and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Architecture

- `src/` — frontend: plain HTML/CSS/JS (no framework), with Mermaid, KaTeX and pdf.js vendored for diagrams, math and the PDF viewer
- `src-tauri/` — Rust backend (Tauri 2): Markdown rendering via
  [comrak](https://github.com/kivikakk/comrak), highlighting via syntect (two-face syntax set),
  HTML sanitization via [ammonia](https://github.com/rust-ammonia/ammonia), plus the model
  provider layer (`providers.rs`, `ai.rs`, `anthropic.rs`: streaming, reasoning, usage/cost, keychain), chat storage, file tree, search, font
  listing, and PDF export commands, plus private web search (`web_search.rs`:
  Google/Bing/DuckDuckGo/Mojeek/SearXNG through proxy/Tor with retries) and highlights (`highlights.rs`)
- `install.sh` — build + Linux desktop integration (desktop file, icons, MIME defaults)
- `scripts/install.sh`, `scripts/install.ps1` — one-command installers for the latest release
