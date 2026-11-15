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
