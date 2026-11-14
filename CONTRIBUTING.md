# Contributing to MarkdownEditor

Thanks for helping. Bug reports, fixes, features, themes and documentation are all welcome.

## Before you start

- For a bug or a small fix, open a pull request directly.
- For a new feature or a larger change, open an issue first so we can agree on the approach
  before you spend time on it.

## Setup

You need [Rust](https://rustup.rs), Node.js 20 or newer, and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm ci
npm run dev
```

## Checks

CI runs these on every pull request. Run them before you push:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
node --check src/main.js
node src/mdsource.js
```

## How the code is organised

- `src/` is the frontend: plain HTML, CSS and JavaScript with no framework and no build step.
  Third-party code is vendored under `src/vendor/`.
- `src-tauri/src/` is the Rust backend. Anything that touches the file system, the network or
  a secret lives here, never in the webview.
- `UI_DESIGN_GUIDELINE.md` describes the look and the interaction rules. Please follow it for
  anything visible.

## Guidelines

- Keep changes small and focused; one topic per pull request.
- Prefer what the platform, the standard library or an existing dependency already offers
  over a new dependency.
- Add a test for logic that can break (parsers, file handling, anything security-related).
- Add a line to `CHANGELOG.md` under "Unreleased" when users will notice the change.
- Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org) style
  (`feat:`, `fix:`, `docs:`, ...).

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your work is released under the [MIT License](LICENSE).
