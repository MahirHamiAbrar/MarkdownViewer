#!/usr/bin/env bash
# Builds MarkdownEditor from source and installs it for the current user on Linux,
# registered as the default app for Markdown files.
#
#   ./install.sh              build + install into ~/.local
#   ./install.sh --reinstall  rebuild, remove the old install, install fresh
#   ./install.sh --uninstall  remove it again
#   ./install.sh --help       show this help
#   PREFIX=/usr/local sudo -E ./install.sh   system-wide install
set -euo pipefail

APP_ID="dev.mhabrar.markdowneditor"
OLD_APP_ID="dev.mhabrar.mdviewer" # the app's id before it was renamed
PREFIX="${PREFIX:-$HOME/.local}"
BIN="$PREFIX/bin/markdowneditor"
APPS="$PREFIX/share/applications"
ICONS="$PREFIX/share/icons/hicolor"
DESKTOP="$APPS/$APP_ID.desktop"
MIME_TYPES=(text/markdown text/x-markdown)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
usage() { sed -n '2,9{s/^# \{0,1\}//;p}' "${BASH_SOURCE[0]}"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

refresh_caches() {
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$APPS" || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -f -t "$ICONS" 2>/dev/null || true
}

remove_files() { # $1 = app id, $2 = binary
  rm -f "$2" "$APPS/$1.desktop" "$ICONS/scalable/apps/$1.svg"
  for size in 32x32 128x128 256x256; do rm -f "$ICONS/$size/apps/$1.png"; done
  local mimeapps="${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
  [[ -f "$mimeapps" ]] && sed -i "/=$1\.desktop;\?$/d; s/$1\.desktop;//g" "$mimeapps"
  return 0
}

uninstall() {
  say "Removing MarkdownEditor from $PREFIX"
  remove_files "$APP_ID" "$BIN"
  remove_files "$OLD_APP_ID" "$PREFIX/bin/mdviewer"
  refresh_caches
  say "Done."
}

install_deps() {
  if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then return; fi
  command -v apt-get >/dev/null || die "Install the Tauri system dependencies for your distro first: https://v2.tauri.app/start/prerequisites/#linux"
  say "Installing system libraries (needs sudo)"
  sudo apt-get update
  sudo apt-get install -y build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev librsvg2-bin libssl-dev
}

# Rasterize app-icon.svg, then let Tauri derive every PNG/ICO/ICNS from it.
gen_icons() {
  command -v rsvg-convert >/dev/null || { say "rsvg-convert not found; using existing icon PNGs"; return; }
  say "Generating icons from app-icon.svg"
  local png; png="$(mktemp --suffix=.png)"
  rsvg-convert -w 1024 -h 1024 "$ROOT/src-tauri/app-icon.svg" -o "$png"
  npx tauri icon "$png" -o "$ROOT/src-tauri/icons" >/dev/null 2>&1 || die "icon generation failed (run: npx tauri icon)"
  rm -rf "$png" "$ROOT/src-tauri/icons/android" "$ROOT/src-tauri/icons/ios"
}

build() {
  command -v cargo >/dev/null || die "Rust is required: https://rustup.rs"
  command -v npm >/dev/null || die "Node.js (npm) is required: https://nodejs.org"
  install_deps
  cd "$ROOT"
  [[ -x node_modules/.bin/tauri ]] || { say "Installing build tools"; npm ci; }
  gen_icons
  say "Building release binary (first build takes a few minutes)"
  npx tauri build --no-bundle
}

install_files() {
  say "Installing into $PREFIX"
  remove_files "$OLD_APP_ID" "$PREFIX/bin/mdviewer" # an install from before the rename
  install -Dm755 "$ROOT/src-tauri/target/release/markdowneditor" "$BIN"
  install -Dm644 "$ROOT/src-tauri/icons/32x32.png" "$ICONS/32x32/apps/$APP_ID.png"
  install -Dm644 "$ROOT/src-tauri/icons/128x128.png" "$ICONS/128x128/apps/$APP_ID.png"
  install -Dm644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICONS/256x256/apps/$APP_ID.png"
  install -Dm644 "$ROOT/src-tauri/app-icon.svg" "$ICONS/scalable/apps/$APP_ID.svg"
  mkdir -p "$APPS"
  cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=MarkdownEditor
GenericName=Markdown Editor
Comment=A calm Markdown viewer and editor
Exec=$BIN %f
Icon=$APP_ID
StartupWMClass=markdowneditor
Terminal=false
Categories=Office;TextEditor;Utility;
MimeType=$(IFS=';'; echo "${MIME_TYPES[*]}");
Keywords=markdown;md;viewer;editor;
EOF
  refresh_caches
  if command -v xdg-mime >/dev/null; then
    xdg-mime default "$APP_ID.desktop" "${MIME_TYPES[@]}"
    say "Default app for Markdown: $(xdg-mime query default text/markdown)"
  else
    say "xdg-mime not found; set MarkdownEditor as default for .md files in your file manager."
  fi
}

case "${1:-}" in
  -h|--help) usage ;;
  --uninstall) uninstall ;;
  --reinstall) build; uninstall; install_files; say "Reinstalled. Open any .md file, or run: $BIN" ;;
  "") build; install_files; say "Installed. Open any .md file, or run: $BIN" ;;
  *) usage >&2; die "unknown option: $1" ;;
esac
