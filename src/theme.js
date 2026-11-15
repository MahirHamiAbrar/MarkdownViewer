// Loaded before first paint so a saved dark theme never flashes light; main.js's applySettings reuses applyTheme.
function applyTheme(theme, root = document.documentElement) {
  // Palettes ride on a light/dark base so every [data-theme] rule still applies.
  // "system" follows the OS with the reader palettes (Sage by day, Plum after dark).
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "plum" : "sage";
  const base = { sepia: "light", eink: "light", monokai: "light", paper: "light", sage: "light", dusk: "dark", forest: "dark", midnight: "dark", plum: "dark", vercel: "dark" }[theme];
  const palette = base ? theme : null;
  root.dataset.theme = base || theme;
  if (palette) root.dataset.palette = palette; else delete root.dataset.palette;
}
// Frosted popups ("Blur effect" setting) default on where the webview paints backdrop-filter: WebKit on
// macOS, WebView2 on Windows. WebKitGTK (Linux) skips it without GPU compositing, so Linux defaults to solid.
// See docs/BLUR.md. main.js reuses this as the setting's default.
const BLUR_DEFAULT = !/Linux/.test(navigator.userAgent) && !matchMedia("(prefers-reduced-transparency: reduce)").matches;
document.documentElement.toggleAttribute("data-blur", BLUR_DEFAULT);
try {
  const s = JSON.parse(localStorage.getItem("settings")) || {};
  applyTheme(s.theme || "system");
  if (typeof s.blur === "boolean") document.documentElement.toggleAttribute("data-blur", s.blur);
  if (s.accent) document.documentElement.dataset.accent = s.accent;
} catch { /* defaults from the markup */ }
