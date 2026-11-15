#!/bin/sh
# Installs the latest MarkdownEditor release on Linux or macOS:
#
#   curl -fsSL https://raw.githubusercontent.com/MahirHamiAbrar/MarkdownViewer/main/scripts/install.sh | sh
#
# Linux: the .deb through apt on Debian and Ubuntu (asks for sudo), otherwise the AppImage into
# ~/.local/bin with a desktop entry. macOS: the app into /Applications (or ~/Applications).
# Every download is checked against the release's SHA256SUMS.
set -eu

REPO="MahirHamiAbrar/MarkdownViewer"
APP_ID="dev.mhabrar.markdowneditor"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

has curl || die "curl is required"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# /releases/latest redirects to /releases/tag/vX.Y.Z; no API call, so no rate limit.
TAG="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
TAG="${TAG##*/}"
case "$TAG" in v[0-9]*) ;; *) die "could not find the latest release" ;; esac
VERSION="${TAG#v}"
BASE="https://github.com/$REPO/releases/download/$TAG"

fetch() { # $1 = release file name; downloads it into $TMP and checks its checksum
  say "Downloading $1"
  curl -fL --progress-bar -o "$TMP/$1" "$BASE/$1"
  [ -f "$TMP/SHA256SUMS" ] || curl -fsSL -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS"
  want="$(awk -v f="$1" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS")"
  [ -n "$want" ] || die "$1 is not listed in SHA256SUMS"
  if has sha256sum; then got="$(sha256sum "$TMP/$1" | awk '{ print $1 }')"
  else got="$(shasum -a 256 "$TMP/$1" | awk '{ print $1 }')"; fi
  [ "$got" = "$want" ] || die "checksum mismatch for $1; not installing"
}

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

install_linux() {
  [ "$(uname -m)" = x86_64 ] || die "release builds are x86_64 only; build from source: https://github.com/$REPO#build-from-source"

  if has apt-get && has dpkg; then
    deb="MarkdownEditor_${VERSION}_amd64.deb"
    fetch "$deb"
    say "Installing $deb (needs sudo)"
    chmod 644 "$TMP/$deb" # apt's sandbox user must be able to read it
    as_root apt-get install -y "$TMP/$deb"
    return
  fi

  appimage="MarkdownEditor_${VERSION}_amd64.AppImage"
  fetch "$appimage"
  bin="$HOME/.local/bin"
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
  say "Installing into $bin"
  mkdir -p "$bin" "$apps" "$icons"
  install -m755 "$TMP/$appimage" "$bin/markdowneditor"
  ln -sf markdowneditor "$bin/mde"
  curl -fsSL -o "$icons/$APP_ID.svg" "https://raw.githubusercontent.com/$REPO/$TAG/src-tauri/app-icon.svg" || true
  cat > "$apps/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MarkdownEditor
GenericName=Markdown Editor
Comment=A calm Markdown viewer and editor
Exec=$bin/markdowneditor %F
Icon=$APP_ID
StartupWMClass=markdowneditor
Terminal=false
Categories=Office;TextEditor;Utility;
MimeType=text/markdown;text/x-markdown;
Keywords=markdown;md;viewer;editor;
EOF
  has update-desktop-database && update-desktop-database -q "$apps" || true
  has xdg-mime && xdg-mime default "$APP_ID.desktop" text/markdown text/x-markdown || true
  # AppImages need FUSE 2 to mount themselves.
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
    say "FUSE 2 (libfuse2) looks missing; install it if the app does not start."
  fi
  case ":$PATH:" in *":$bin:"*) ;; *) say "Add $bin to your PATH to use the mde command." ;; esac
}

install_macos() {
  dmg="MarkdownEditor_${VERSION}_universal.dmg"
  fetch "$dmg"
  apps=/Applications
  [ -w "$apps" ] || { apps="$HOME/Applications"; mkdir -p "$apps"; }
  say "Installing into $apps"
  mnt="$TMP/mnt"
  hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$TMP/$dmg"
  rm -rf "$apps/MarkdownEditor.app"
  cp -R "$mnt/MarkdownEditor.app" "$apps/"
  hdiutil detach -quiet "$mnt"
  # The build is not notarized yet; curl sets no quarantine flag, but clear any left over.
  xattr -dr com.apple.quarantine "$apps/MarkdownEditor.app" 2>/dev/null || true

  # Terminal command: /usr/local/bin when writable, else ~/.local/bin.
  bin=/usr/local/bin
  [ -d "$bin" ] && [ -w "$bin" ] || { bin="$HOME/.local/bin"; mkdir -p "$bin"; }
  exe="$(defaults read "$apps/MarkdownEditor.app/Contents/Info" CFBundleExecutable)"
  for name in markdowneditor mde; do
    printf '#!/bin/sh\nexec "%s/MarkdownEditor.app/Contents/MacOS/%s" "$@"\n' "$apps" "$exe" > "$bin/$name"
    chmod 755 "$bin/$name"
  done
  case ":$PATH:" in *":$bin:"*) ;; *) say "Add $bin to your PATH to use the mde command." ;; esac
}

say "Installing MarkdownEditor $VERSION"
case "$(uname -s)" in
  Linux) install_linux ;;
  Darwin) install_macos ;;
  *) die "unsupported system $(uname -s); on Windows run: irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" ;;
esac
say "MarkdownEditor $VERSION installed. Open any .md file, or run: mde <file or folder>"
