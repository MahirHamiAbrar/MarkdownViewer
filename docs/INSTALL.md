# Installing MarkdownEditor

## One command

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

## Manual download

Download the latest package from the
[Releases page](https://github.com/MahirHamiAbrar/MarkdownViewer/releases/latest); no build
required:

- **`MarkdownEditor_<version>_amd64.deb`**: Debian, Ubuntu, and derivatives
- **`MarkdownEditor_<version>_amd64.AppImage`**: any other distribution with a desktop
- **`MarkdownEditor_<version>_universal.dmg`**: macOS (Apple silicon and Intel)
- **`MarkdownEditor_<version>_x64-setup.exe`** or **`_x64_en-US.msi`**: Windows

The macOS and Windows builds are not code-signed yet. On macOS, right-click the app and choose
**Open** the first time; on Windows, choose **More info → Run anyway** in SmartScreen.

```sh
# Debian / Ubuntu: installs the app and pulls in its system dependencies
sudo apt install ./MarkdownEditor_<version>_amd64.deb

# AppImage: no installation, just make it executable and run it
chmod +x MarkdownEditor_<version>_amd64.AppImage
./MarkdownEditor_<version>_amd64.AppImage
```

Both come with a desktop entry and Markdown file associations, plus the `markdowneditor`
command (and its short alias `mde`).

## Updates

The app checks GitHub Releases, downloads new versions in the background, and asks you to
restart. Settings → Updates turns this off. In-place updates work for the AppImage, macOS and
Windows builds; `.deb` installs get a download link.

## Verify your download

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

## Build from source (Linux)

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
for other distributions, and [BUILDING.md](BUILDING.md) for other platforms and signing.
