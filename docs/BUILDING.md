# Building and signing

Released binaries are Linux only (`.deb` and `.AppImage`, from
[GitHub Releases](https://github.com/MahirHamiAbrar/MarkdownViewer/releases)). On Windows and
macOS, build the app yourself; the steps are below.

## Any platform

Install [Rust](https://rustup.rs), Node.js 20 or newer and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run build
```

Installers land in `src-tauri/target/release/bundle/`.

> Windows and macOS builds are not part of CI and are tested less than Linux. Please report
> what breaks.

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

1. Move the "Unreleased" notes in `CHANGELOG.md` under a new `## [X.Y.Z]` heading.
2. Set the same version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.
3. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.

The Release workflow refuses to run if the tag, the version and the changelog disagree, or if
the signing secrets (`GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`) are missing.
