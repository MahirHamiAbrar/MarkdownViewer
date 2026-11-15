# Changelog

All notable changes to MarkdownEditor are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
