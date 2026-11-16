# Building and signing

Released binaries for Linux (`.deb`, `.AppImage`), macOS (`.dmg`) and Windows (`.msi`, setup
`.exe`) are on [GitHub Releases](https://github.com/MahirHamiAbrar/MarkdownViewer/releases). To
build the app yourself, follow the steps below.

## Any platform

Install [Rust](https://rustup.rs), Node.js 20 or newer and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run build
```

Installers land in `src-tauri/target/release/bundle/`.

> Windows and macOS builds are tested less than Linux. Please report what breaks.

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

CI ([`.github/workflows`](../.github/workflows)) runs the tests on every push and pull request.

## Architecture

- `src/`: frontend, plain HTML/CSS/JS (no framework), with Mermaid, KaTeX and pdf.js vendored for diagrams, math and the PDF viewer
- `src-tauri/`: Rust backend (Tauri 2): Markdown rendering via
  [comrak](https://github.com/kivikakk/comrak), highlighting via syntect (two-face syntax set),
  HTML sanitization via [ammonia](https://github.com/rust-ammonia/ammonia), plus the model
  provider layer (`providers.rs`, `ai.rs`, `anthropic.rs`: streaming, reasoning, usage/cost, keychain), chat storage, file tree, search, font
  listing, and PDF export commands, plus private web search (`web_search.rs`:
  Google/Bing/DuckDuckGo/Mojeek/SearXNG through proxy/Tor with retries) and highlights (`highlights.rs`)
- `install.sh`: build + Linux desktop integration (desktop file, icons, MIME defaults)
- `scripts/install.sh`, `scripts/install.ps1`: one-command installers for the latest release

## Signing your own build

**Linux (AppImage).** Set `SIGN=1`, optionally `SIGN_KEY=<gpg key id>` and
`APPIMAGETOOL_SIGN_PASSPHRASE`, before `npm run build`.

**macOS.** With an Apple Developer certificate in your keychain, set
`APPLE_SIGNING_IDENTITY`, and for notarization `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
password) and `APPLE_TEAM_ID`. Tauri signs and notarizes during the build.

**Windows.** Add your certificate's thumbprint to a local copy of
`src-tauri/tauri.conf.json` under `bundle.windows` (`certificateThumbprint`,
`digestAlgorithm`, `timestampUrl`), or point `bundle.windows.signCommand` at your signing tool.

See the Tauri guides for [macOS](https://v2.tauri.app/distribute/sign/macos/),
[Windows](https://v2.tauri.app/distribute/sign/windows/) and
[Linux](https://v2.tauri.app/distribute/sign/linux/).

## Releasing (maintainers)

Every push to `main` on GitHub (except docs-only changes) publishes a release. The version is
the app version when it is higher than the latest `v*` tag, otherwise the latest tag's patch
number plus one; the workflow creates the tag. Release notes come from the matching
`CHANGELOG.md` section, else "Unreleased", else the commit subjects.

For a minor or major release, move the "Unreleased" notes under a new `## [X.Y.Z]` heading and
set that version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`
before pushing.

The Release workflow refuses to run if the signing secrets (`GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`) are missing.
