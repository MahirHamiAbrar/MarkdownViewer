# Blur effect

Popups, menus, the command palette, the selection chip and the drop overlay can be drawn as frosted
glass (translucent, with the content behind them blurred) or as solid panels.

**Settings → Turn on Blur Effect** switches between the two.

| Platform | Default | Webview |
|---|---|---|
| macOS | On | WKWebView (WebKit) |
| Windows | On | WebView2 (Chromium) |
| Linux | Off | WebKitGTK |

If the OS asks apps to reduce transparency (`prefers-reduced-transparency: reduce`), the default is
off everywhere. Your choice in Settings always wins and is remembered.

## How it works

- `src/theme.js` runs before first paint and sets the `data-blur` attribute on `<html>`, from the
  saved setting or, if none, from the platform default (`BLUR_DEFAULT`).
- `src/main.js` uses `BLUR_DEFAULT` as the default of the `blur` setting and updates `data-blur`
  whenever settings change.
- `src/styles.css` adds `backdrop-filter` and the translucent `--bg-raised` colors only under
  `[data-blur]`. Without it, `--bg-raised` is a solid color per theme.

## Why Linux defaults to off

WebKitGTK paints `backdrop-filter` only when GPU (accelerated) compositing is active, and in
WebKitGTK 2.52 accelerated compositing runs only through the DMA-BUF renderer. When that renderer is
off, hardware acceleration is "never" (see `webkit://gpu`) and the blur is silently skipped:
popups become see-through with sharp text behind them. Plain `filter: blur()` still works because it
does not need compositing.

**Settings → GPU acceleration** (Auto / On / Off, Linux only) picks the renderer at launch;
`src-tauri/src/gpu.rs` reads it from `~/.markdowneditor/gpu` and a change applies after a restart.
Auto turns it on everywhere except the NVIDIA proprietary driver:

- **NVIDIA proprietary driver:** WebKitGTK disables the DMA-BUF renderer on its own, so "on" also sets
  `WEBKIT_FORCE_DMABUF_RENDERER=1`. On X11 that produced a blank window. On Wayland it draws, and dialogs
  scroll smoothly, but long documents with images scroll worse than on the CPU (RTX 3060, driver 580).
- **Intel / AMD (Mesa):** the renderer works without forcing. "Off" sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which launches faster but draws on the CPU.

A WebKit variable already set in the environment wins over the setting.

Don't hide the window at start and show it later to cover the GPU renderer's layer-by-layer first
frame: on Linux, Tauri's `show()` is GTK's `show_all()`, and calling it once the webview exists made
preview scrolling choppy (measured with release builds, GPU on and off).

The webview still reports `CSS.supports("backdrop-filter", ...)` as true, so support can't be
detected from JavaScript; the default is chosen by platform instead.

Measured on WebKitGTK 2.52.6, Ubuntu 24.04, GNOME, NVIDIA RTX 3060 (driver 580), with a striped
test page and a `backdrop-filter: blur(12px)` panel:

| Setup | Acceleration | Backdrop blur |
|---|---|---|
| NVIDIA, defaults | never | no |
| NVIDIA, `WEBKIT_DISABLE_DMABUF_RENDERER=1` | never | no |
| NVIDIA, transparent window on or off | never | no |
| NVIDIA, `WEBKIT_FORCE_DMABUF_RENDERER=1` | always | blank window |
| Mesa (llvmpipe), defaults | always | yes |
| Mesa (llvmpipe), `WEBKIT_DISABLE_DMABUF_RENDERER=1` | never | no |

Linux users whose setup does composite (for example Intel/AMD, launched with
`WEBKIT_DISABLE_DMABUF_RENDERER=0`) can turn the setting on. With it on and no compositing, popups
are translucent but not blurred.
