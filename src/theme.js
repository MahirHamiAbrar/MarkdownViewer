// Loaded before first paint so a saved dark theme never flashes light; main.js's applySettings reuses applyTheme.
function applyTheme(theme, root = document.documentElement) {
  // Palettes ride on a light/dark base so every [data-theme] rule still applies.
  const palette = theme === "monokai" || theme === "vercel" ? theme : null;
  root.dataset.theme = { monokai: "light", vercel: "dark", system: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" }[theme] || theme;
  if (palette) root.dataset.palette = palette; else delete root.dataset.palette;
}
try {
  const s = JSON.parse(localStorage.getItem("settings")) || {};
  applyTheme(s.theme || "system");
  if (s.accent) document.documentElement.dataset.accent = s.accent;
} catch { /* defaults from the markup */ }
