# Changelog

All notable changes to MarkdownEditor are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Syntax colors in the editor (Edit and Split modes): headings, emphasis, links, code, math,
  lists, quotes, tables, HTML and front matter, in the colors of the current theme.
- Suggestions while typing: `/` at the start of a line inserts a block (heading, table, code
  block, math, callout, Mermaid diagram…), an opening fence suggests a language, `](` suggests
  workspace files (images after `![`), `](#` suggests headings, and three letters suggest longer
  words from the document. Enter or Tab inserts (only Tab for words). Settings → Editor and files
  → Suggestions turns them off.
- Auto-close: typing `(`, `[`, `{` or `` ` `` adds the closer, typing the closer steps over it,
  and Backspace removes an empty pair. Enter after an opening code fence or `$$` adds the closing one.

- Click an image or a Mermaid diagram to expand it: drag to move, scroll or pinch to zoom,
  double-click to zoom in, `0` fits, `1` shows actual size, Esc closes.
- Automatic updates: the app checks GitHub Releases, downloads and installs new versions in the
  background with a progress bar, and asks you to restart. Settings → Updates turns automatic
  checks and installs off, and has Check for updates and Install latest update buttons.
  In-place updates work for the AppImage, macOS and Windows builds; `.deb` installs get a
  download link.

## [0.2.2] - 2026-11-15

### Added

- macOS (universal `.dmg`) and Windows (`.msi` and setup `.exe`) builds on the Releases page.
  They are not code-signed yet.
- Tabs: a window keeps several documents open (Ctrl+W closes, Ctrl+Tab cycles), and unsaved
  tabs are restored after a restart.
- Workspaces: a window holds any number of folders plus loose files, restored on launch and
  refreshed when files change on disk.
- Command line: `markdowneditor [options] [path[:line]]...` opens files, folders, a line number
  or a new file; `mde` is a short alias.
- Big Brain reads every text file in the workspace, with `@` mentions in the composer.
- Big Brain inspects PDFs and reads them as text or page images.
- Big Brain can edit and create workspace files; every change shows a diff and waits for
  Accept or Reject (Settings → Big Brain → File changes).
- Export as HTML (Ctrl Shift E): one self-contained page with styles, math fonts and local
  images embedded.
- PDF and HTML files open in a built-in viewer, from the open dialog, the folder tree, drag and
  drop, or the "Open" button shown after an export. PDFs use a bundled pdf.js.

### Changed

- Export as PDF (Ctrl P) writes the file directly on Linux instead of opening the print dialog.
- The assistant is now called **Big Brain** (it was "Mark").

## [0.2.0] - 2026-11-15

### Added

- Mark works with several model providers: DeepSeek, OpenAI, Anthropic, OpenRouter, Ollama, and
  Command Code are built in, and any OpenAI- or Anthropic-compatible endpoint can be added as a
  custom model API (Settings → Mark → Add model provider).
- A model picker in Mark's header, with reasoning effort levels per model. Model lists are
  fetched from the provider.
- `~/.markdowneditor/providers.json` for editing providers by hand.
- Unsaved text is recovered after a crash or power cut.

### Changed

- The app is now called **MarkdownEditor** (it was "Markdown"). Its data folder moves from
  `~/.markdown-viewer-app` to `~/.markdowneditor` on first start. Because the app identifier
  changed, appearance settings and the recent-files list start fresh.
- API keys are stored in the system keychain instead of `config.json`. An existing key is moved
  on first start.
- Saving a document is atomic: a crash while saving leaves the previous file intact.
- Releases are published on GitHub, signed with GPG, with checksums and build provenance.

## [0.1.0]

First release: Markdown viewer and editor with live preview, folder tree, search, command
palette, themes, KaTeX, Mermaid, PDF export, and the Mark assistant.
