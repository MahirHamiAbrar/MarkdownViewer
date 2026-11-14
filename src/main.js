"use strict";

const { invoke, convertFileSrc, Channel } = window.__TAURI__.core;

const dialog = window.__TAURI__.dialog;
const opener = window.__TAURI__.opener;
const tpath = window.__TAURI__.path; // only for homeDir at boot: per-render IPC calls add latency
const appWindow = window.__TAURI__.window.getCurrentWindow();
const webview = window.__TAURI__.webview.getCurrentWebview();

// App elements are looked up by class, never id: rendered headings carry ids of their own.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = {
  root: document.documentElement,
  win: $(".window"),
  docName: $(".doc-name"),
  dirty: $(".dirty-dot"),
  tbDoc: $(".tb-doc"),
  modeSeg: $(".tb-doc .segmented"),
  maxBtn: $('[data-action="maximize"] use'),
  sidebar: $(".sidebar"),
  splitter: $(".splitter"),
  sbSearch: $(".sb-search"),
  sbClear: $('[data-action="clear-search"]'),
  sbList: $(".sb-list"),
  welcome: $(".welcome"),
  welcomeList: $(".welcome .history-list"),
  welcomeEmpty: $(".welcome .history-empty"),
  history: $(".history"),
  historyList: $(".history .history-list"),
  historyEmpty: $(".history .history-empty"),
  historyCount: $(".history-count"),
  paletteDlg: $(".dlg-palette"),
  paletteInput: $(".palette-input"),
  paletteList: $(".palette-list"),
  aboutDlg: $(".dlg-about"),
  aboutVer: $(".about-ver"),
  doc: $(".doc"),
  editor: $(".editor"),
  previewPane: $(".preview-pane"),
  preview: $(".md"),
  findbar: $(".findbar"),
  findInput: $(".find-input"),
  findCount: $(".find-count"),
  replaceInput: $(".replace-input"),
  replaceRow: $(".replace-row"),
  findToggle: $(".find-toggle"),
  editorHl: $(".editor-hl"),
  menu: $(".ctx-menu"),
  status: $(".statusbar"),
  stPath: $(".st-path"),
  stPos: $(".st-pos"),
  stWords: $(".st-words"),
  stSave: $(".st-save"),
  drop: $(".drop-overlay"),
  toasts: $(".toasts"),
  tooltip: $(".tooltip"),
  settingsDlg: $(".dlg-settings"),
  confirmDlg: $(".dlg-confirm"),
  swatches: $(".swatches"),
  fontMenu: $(".font-menu"),
  aiPanel: $(".ai-panel"),
  aiSplitter: $(".ai-splitter"),
  aiMessages: $(".ai-messages"),
  aiHistory: $(".ai-history"),
  aiHistoryList: $(".ai-history-list"),
  aiTitle: $(".ai-title"),
  aiTitleInput: $(".ai-title-input"),
  aiEffortLabel: $(".ai-effort-label"),
  aiCtx: $(".ai-context"),
  aiChipFile: $(".ai-chip-file"),
  aiChipSel: $(".ai-chip-sel"),
  aiChipReply: $(".ai-chip-reply"),
  aiChatTotal: $(".ai-chat-total"),
  aiComposer: $(".ai-composer"),
  aiInput: $(".ai-input"),
  aiSend: $(".ai-send"),
  aiStop: $(".ai-stop"),
  aiSelChip: $(".ai-selchip"),
  aiMenu: $(".ai-menu"),
  aiModelName: $(".ai-model-name"),
  aiProviders: $(".ai-providers"),
  provDlg: $(".dlg-provider"),
  aiProfile: $(".ai-profile"),
  aiMemoryList: $(".ai-memory-list"),
  aiDelDlg: $(".dlg-ai-delete"),
  aiDelName: $(".ai-del-name"),
};

const MD_RE = /\.(md|markdown|mdx)$/i;
const MAX_RECENTS = 30;
const SIDEBAR_RECENTS = 6;
const FONT_SIZES = ["13", "14", "16", "18"]; // the Font size setting's steps
const ACCENTS = {
  blue: "#2A7BEF", red: "#F0505F", green: "#2FB458", purple: "#7B5CF5",
  pink: "#D14FA8", orange: "#FF9A2E", graphite: "#454C5C",
};
// Setting -> [CSS variable, what it falls back to]
const FONT_VARS = { fontUi: ["--font-ui", "--font-ui-base"], fontEditor: ["--font-editor", "--font-mono"], fontView: ["--font-view", "--font-ui"] };
const TILE_COLORS = ["#2F80F5", "#F5822E", "#27B5C9", "#8C7CF0", "#F26B8A", "#4F7CF0", "#35B864", "#6B7384"];
// Effort levels come from each model; this is only their menu order and wording.
const AI_EFFORT_ORDER = ["off", "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const AI_EFFORT_INFO = {
  off: ["Off", "Fastest"], auto: ["Auto", "Model default"], none: ["None", "Fastest"], minimal: ["Minimal", "Fast"], low: ["Low", "Quick"],
  medium: ["Medium", "Balanced"], high: ["High", "Deeper"], xhigh: ["Extra high", "Thorough"], max: ["Max", "Deepest"],
};
const AI_MAX_REASONING = 100_000;
const AI_TOOL_LABELS = {
  read_document: "Read document", search_document: "Searched document", list_files: "Listed files",
  search_files: "Searched folder", read_file: "Read file", remember: "Remembered", forget: "Forgot",
};
const aiEffortName = (value) => AI_EFFORT_INFO[value]?.[0] || value || "";

// ---------- persistence (localStorage, per-viewer conveniences) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const DEFAULT_SETTINGS = {
  theme: "system", accent: "blue", fontSize: "13", width: "normal", fontUi: "", fontEditor: "", fontView: "", aiEffort: "high", aiProvider: "", aiModel: "", aiMemory: "on",
  lineHeight: "normal", align: "left", codeWrap: "scroll", tabSize: "2", autosave: "off", startup: "last",
};
const READ_WIDTHS = { narrow: "640px", normal: "760px", wide: "980px", full: "100%" };

const state = {
  path: null,       // open file
  untitled: false,  // new-file buffer not saved anywhere yet
  saved: "",        // content on disk
  text: "",         // content in editor
  mode: store.get("mode", "read"),
  recents: store.get("recents", []),
  folder: store.get("folder", null),
  tree: [],
  expanded: new Set(),
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
  home: "",
  sep: "/",
  ai: {
    open: false, chat: null, list: [], streaming: false, requestId: null, selection: null, reply: null,
    renderTimer: null, pinned: true, current: null, chip: null, deleteTarget: null, titleBusy: false,
    providers: [], // model providers with their key status; see providers.rs
    memory: normalizeMemory(null), // what Mark knows about the user; lives in ~/.markdowneditor/memory.json
  },
};

// ---------- small helpers ----------
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const svg = (name) => `<svg><use href="#i-${name}"/></svg>`;
const baseName = (p) => p.split(/[\\/]/).pop();
const dirName = (p) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))) || p;
const isDirty = () => (state.path !== null || state.untitled) && state.text !== state.saved;

function prettyDir(p) {
  let d = dirName(p);
  if (state.home && d.startsWith(state.home)) d = "~" + d.slice(state.home.length);
  return truncateMiddle(d, 34);
}

function truncateMiddle(s, max) {
  if (s.length <= max) return s;
  const keep = max - 1;
  return s.slice(0, Math.ceil(keep / 2)) + "…" + s.slice(s.length - Math.floor(keep / 2));
}

function tileColor(p) {
  let h = 0;
  for (const c of dirName(p)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

/** Resolves a link/image target from the open document to an absolute local path, without IPC. */
function resolveLocal(ref) {
  const p = decodeURIComponent(ref.replace(/^file:\/\//i, "").split(/[?#]/)[0]);
  if (/^([\\/]|[a-z]:[\\/])/i.test(p)) return p;
  if (!state.path) return p; // untitled buffers have no folder to resolve against
  const sep = state.path.includes("\\") ? "\\" : "/";
  const parts = dirName(state.path).split(/[\\/]/);
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..") { if (parts.length > 1) parts.pop(); }
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join(sep);
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(q, "gi"), (m) => `<mark>${m}</mark>`);
}

// ---------- toasts ----------
function toast(message, kind = "success") {
  const t = document.createElement("div");
  t.className = `toast popover ${kind}`;
  t.setAttribute("role", kind === "error" ? "alert" : "status");
  t.innerHTML = `<span class="icon-tile">${svg(kind === "error" ? "alert" : "check")}</span>
    <div class="toast-text"></div><button class="icon-btn" aria-label="Dismiss">${svg("x")}</button>`;
  $(".toast-text", t).textContent = message;
  const close = () => { t.classList.add("leaving"); setTimeout(() => t.remove(), 200); };
  $("button", t).onclick = close;
  el.toasts.append(t);
  while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  // Errors stay until dismissed; success toasts auto-dismiss (paused on hover).
  if (kind !== "error") {
    let timer = setTimeout(close, 3000);
    t.onmouseenter = () => clearTimeout(timer);
    t.onmouseleave = () => { timer = setTimeout(close, 1500); };
  }
}

// ---------- settings / theme ----------
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function applySettings() {
  const s = state.settings;
  applyTheme(s.theme, el.root); // theme.js
  el.root.dataset.accent = s.accent;
  el.root.style.setProperty("--fs-root", `${s.fontSize}px`);
  el.root.style.setProperty("--read-w", READ_WIDTHS[s.width] || READ_WIDTHS.normal);
  for (const key of ["lineHeight", "align", "codeWrap", "tabSize"]) el.root.dataset[key] = s[key]; // styled in styles.css
  for (const [key, [cssVar, fallback]] of Object.entries(FONT_VARS)) {
    const name = s[key].replace(/["\\]/g, "");
    if (name) el.root.style.setProperty(cssVar, `"${name}", var(${fallback})`);
    else el.root.style.removeProperty(cssVar);
  }
  for (const seg of $$("[data-setting]")) {
    for (const b of $$("button", seg)) b.setAttribute("aria-checked", String(b.dataset.value === s[seg.dataset.setting]));
  }
  for (const b of $$(".swatch")) b.setAttribute("aria-checked", String(b.dataset.accent === s.accent));
  updateAiModelLabel();
  store.set("settings", s);
  if (mermaidTheme && mermaidTheme !== `${el.root.dataset.theme}|${el.root.dataset.palette}|${el.root.dataset.accent}`) {
    for (const block of $$(".mermaid-block", el.preview)) renderMermaid(block);
  }
}

systemDark.addEventListener("change", applySettings);

el.swatches.innerHTML = Object.entries(ACCENTS).map(([name, c]) =>
  `<button class="swatch" role="radio" data-accent="${name}" style="--c:${c}" aria-label="${name[0].toUpperCase() + name.slice(1)}" data-tip="${name[0].toUpperCase() + name.slice(1)}">${svg("check")}</button>`).join("");

el.settingsDlg.addEventListener("click", (e) => {
  if (e.target === el.settingsDlg) return el.settingsDlg.close(); // click on backdrop
  const sw = e.target.closest(".swatch");
  if (sw) state.settings.accent = sw.dataset.accent;
  const seg = e.target.closest("[data-setting] button");
  if (seg) {
    const key = seg.parentElement.dataset.setting;
    state.settings[key] = seg.dataset.value;
  }
  if (sw || seg) applySettings();
});
function setFont(input, name) {
  state.settings[input.dataset.font] = name.trim();
  applySettings();
}

let fontsLoaded = false;
function openSettings() {
  applySettings();
  for (const input of $$("[data-font]", el.settingsDlg)) input.value = state.settings[input.dataset.font];
  loadAiProviders();
  loadAiMemory().then(() => {
    el.aiProfile.value = state.ai.memory.profile;
    renderAiMemory();
  });
  el.settingsDlg.showModal();
  if (fontsLoaded) return;
  fontsLoaded = true;
  invoke("list_fonts").then((list) => {
    fonts = list;
    if (!el.fontMenu.hidden) showFontMenu(fontMenu.input);
  }, () => { fontsLoaded = false; });
}

async function openAbout() {
  try {
    el.aboutVer.textContent = await invoke("app_version");
  } catch { /* keep the placeholder dash */ }
  el.aboutDlg.showModal();
}

// ---------- font picker (searchable dropdown) ----------
let fonts = [];
const fontMenu = { input: null, items: [], active: -1 };

function showFontMenu(input) {
  fontMenu.input = input;
  const q = input.value.trim().toLowerCase();
  // ponytail: first 200 matches only; typing narrows the list.
  fontMenu.items = ["", ...fonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 200)];
  fontMenu.active = -1;
  el.fontMenu.innerHTML = fontMenu.items.map((f, i) =>
    `<div class="font-opt${f ? "" : " default"}" role="option" id="app-font-opt-${i}" data-i="${i}" aria-selected="false">${f ? highlight(f, q) : "Default"}</div>`).join("");
  el.fontMenu.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
  // Below the field, or above it when the window is too short.
  const r = input.closest(".font-field").getBoundingClientRect();
  const h = el.fontMenu.offsetHeight;
  const top = r.bottom + 4 + h <= innerHeight ? r.bottom + 4 : Math.max(4, r.top - 4 - h);
  Object.assign(el.fontMenu.style, { left: `${r.left}px`, top: `${top}px`, width: `${r.width}px` });
}

function hideFontMenu() {
  el.fontMenu.hidden = true;
  fontMenu.input?.setAttribute("aria-expanded", "false");
  fontMenu.input?.removeAttribute("aria-activedescendant");
}

function setActiveFont(i) {
  const opts = el.fontMenu.children;
  if (!opts.length) return;
  fontMenu.active = (i + opts.length) % opts.length;
  for (const [j, o] of [...opts].entries()) o.setAttribute("aria-selected", String(j === fontMenu.active));
  opts[fontMenu.active].scrollIntoView({ block: "nearest" });
  fontMenu.input.setAttribute("aria-activedescendant", opts[fontMenu.active].id);
}

function chooseFont(i) {
  const name = fontMenu.items[i];
  fontMenu.input.value = name;
  setFont(fontMenu.input, name);
  hideFontMenu();
}

el.settingsDlg.addEventListener("input", (e) => {
  if (!e.target.dataset.font) return;
  setFont(e.target, e.target.value);
  showFontMenu(e.target);
});
el.settingsDlg.addEventListener("focusin", (e) => { if (e.target.dataset.font) showFontMenu(e.target); });
el.settingsDlg.addEventListener("focusout", (e) => { if (e.target.dataset.font) hideFontMenu(); });
el.settingsDlg.addEventListener("click", (e) => {
  if (e.target.dataset.font && el.fontMenu.hidden) showFontMenu(e.target);
});
el.settingsDlg.addEventListener("keydown", (e) => {
  if (!e.target.dataset.font) return;
  const open = !el.fontMenu.hidden;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open) showFontMenu(e.target);
    setActiveFont(fontMenu.active + (e.key === "ArrowDown" ? 1 : -1));
  } else if (e.key === "Enter" && open && fontMenu.active >= 0) {
    e.preventDefault();
    chooseFont(fontMenu.active);
  } else if (e.key === "Escape" && open) {
    e.preventDefault(); // close the list, not the dialog
    hideFontMenu();
  }
});
el.fontMenu.addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep focus in the field
  const opt = e.target.closest(".font-opt");
  if (opt) chooseFont(Number(opt.dataset.i));
});

// ---------- unsaved changes dialog ----------
function confirmUnsaved() {
  if (!isDirty()) return Promise.resolve("discard");
  $("h2", el.confirmDlg).textContent = `Save changes to “${state.path ? baseName(state.path) : "Untitled"}”?`;
  el.confirmDlg.returnValue = "cancel";
  el.confirmDlg.showModal();
  $('[value="save"]', el.confirmDlg).focus();
  return new Promise((resolve) => {
    el.confirmDlg.addEventListener("close", () => resolve(el.confirmDlg.returnValue || "cancel"), { once: true });
  });
}
for (const b of $$("button[value]", el.confirmDlg)) b.onclick = () => el.confirmDlg.close(b.value);

/** Resolves true when it is safe to replace the current document. */
async function settleUnsaved() {
  const choice = await confirmUnsaved();
  if (choice === "cancel") return false;
  if (choice === "save") return save();
  return true;
}

// ---------- recents ----------
function addRecent(p) {
  state.recents = [p, ...state.recents.filter((r) => r !== p)].slice(0, MAX_RECENTS);
  store.set("recents", state.recents);
}

function removeRecent(p) {
  state.recents = state.recents.filter((r) => r !== p);
  store.set("recents", state.recents);
  renderSidebar();
  renderWelcome();
  renderHistory();
}

// ---------- opening / saving ----------
/** Resolves true once the file is shown. `quiet` skips the error toast (used at startup). */
async function openFile(p, { fragment = null, find: query = null, line = null, quiet = false } = {}) {
  if (p === state.path) { // already open: keep any unsaved edits, just navigate
    if (fragment) scrollToFragment(fragment);
    if (query) openFind(query, { line });
    return true;
  }
  if (!(await settleUnsaved())) return false;
  let text;
  try {
    text = await invoke("read_file", { path: p });
  } catch {
    if (quiet) return false;
    toast(`Couldn't open “${baseName(p)}”. It may have been moved or deleted.`, "error");
    if (state.recents.includes(p)) removeRecent(p);
    return false;
  }
  Object.assign(state, { path: p, saved: text, text, untitled: false });
  renderSrc = null; // relative images resolve against the new file's folder
  el.editor.value = text;
  resetHistory();
  addRecent(p);
  store.set("lastFile", p);
  revealInTree(p);
  showDoc();
  await renderPreview();
  el.previewPane.scrollTop = 0;
  el.editor.scrollTop = 0;
  if (fragment) scrollToFragment(fragment);
  if (query) openFind(query, { line });
  else if (!el.findbar.hidden) runFind(el.findInput.value);
  return true;
}

async function save() {
  if (!state.path) return saveAs();
  try {
    await invoke("write_file", { path: state.path, contents: state.text });
  } catch (err) {
    toast(`Couldn't save “${baseName(state.path)}”. ${err}`, "error");
    return false;
  }
  state.saved = state.text;
  updateChrome();
  el.stSave.innerHTML = `${svg("check")}Saved`;
  return true;
}

async function saveAs() {
  const p = await dialog.save({ defaultPath: "Untitled.md", filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }] });
  if (!p) return false;
  const path = MD_RE.test(p) ? p : p + ".md";
  try {
    await invoke("write_file", { path, contents: state.text });
  } catch (err) {
    toast(`Couldn't save “${baseName(path)}”. ${err}`, "error");
    return false;
  }
  Object.assign(state, { path, saved: state.text, untitled: false });
  addRecent(path);
  store.set("lastFile", path);
  revealInTree(path);
  renderSrc = null; // relative images now resolve against the new file's folder
  renderPreview();
  renderSidebar();
  updateChrome();
  el.stSave.innerHTML = `${svg("check")}Saved`;
  return true;
}

async function newFile() {
  if (!(await settleUnsaved())) return;
  Object.assign(state, { path: null, untitled: true, saved: "", text: "" });
  renderSrc = null;
  el.editor.value = "";
  resetHistory();
  showDoc();
  setMode("edit");
  renderPreview();
}

async function newWindow() {
  try {
    await invoke("new_window");
  } catch (err) {
    toast(`Couldn't open a new window. ${err}`, "error");
  }
}

async function pickFile() {
  const p = await dialog.open({ multiple: false, directory: false, filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }, { name: "All files", extensions: ["*"] }] });
  if (p) openFile(p);
}

async function pickFolder() {
  const p = await dialog.open({ directory: true, multiple: false });
  if (p) setFolder(p);
}

async function setFolder(p) {
  state.folder = p;
  store.set("folder", p);
  await loadTree();
}

async function loadTree() {
  state.tree = state.folder ? await invoke("list_markdown", { dir: state.folder }) : [];
  if (state.path) revealInTree(state.path);
  renderSidebar();
}

function folderFiles(nodes = state.tree, out = []) {
  for (const n of nodes) n.children ? folderFiles(n.children, out) : out.push(n.path);
  return out;
}

function revealInTree(p) {
  if (!state.folder || !p.startsWith(state.folder)) return;
  let d = dirName(p);
  while (d.length > state.folder.length) { state.expanded.add(d); d = dirName(d); }
}

// ---------- rendering ----------
// At most one render is in flight; edits made meanwhile trigger exactly one follow-up render.
// The returned promise settles once the preview matches the current text.
let renderJob = null;
let renderAgain = false;
let renderSrc = null; // text of the in-flight render, or of the last one shown
function renderPreview() {
  if (renderJob) { renderAgain ||= state.text !== renderSrc; return renderJob; }
  if (state.text === renderSrc) return Promise.resolve();
  renderJob = (async () => {
    try {
      do {
        renderAgain = false;
        renderSrc = state.text;
        const html = await invoke("render_markdown", { src: renderSrc });
        if (!renderAgain) patchPreview(html); // skip stale output, the next pass replaces it
      } while (renderAgain);
    } finally {
      renderJob = null;
    }
  })();
  return renderJob;
}

// HTML of each top-level preview node as rendered (before decoration), so a re-render
// only swaps the blocks that changed instead of re-laying out the whole document.
let renderedBlocks = [];
const blockHtml = (n) => (n.nodeType === Node.ELEMENT_NODE ? n.outerHTML : "#" + n.textContent);

function patchPreview(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const next = [...tpl.content.childNodes];
  const nextHtml = next.map(blockHtml);
  const live = [...el.preview.childNodes];
  const old = live.length === renderedBlocks.length ? renderedBlocks : []; // out of sync: replace all
  let start = 0;
  while (start < old.length && start < next.length && old[start] === nextHtml[start]) start++;
  let end = 0;
  while (end < old.length - start && end < next.length - start
    && old[old.length - 1 - end] === nextHtml[next.length - 1 - end]) end++;

  const findOpen = !el.findbar.hidden && el.findInput.value && !findsSource();
  const frag = document.createDocumentFragment();
  frag.append(...next.slice(start, next.length - end));
  decoratePreview(frag);
  const anchor = old.length ? live[live.length - end] ?? null : null;
  for (const n of old.length ? live.slice(start, live.length - end) : live) n.remove();
  el.preview.insertBefore(frag, anchor);
  renderedBlocks = nextHtml;
  if (findOpen) runFind(el.findInput.value, { keepIndex: true, scroll: false });
}

function decorateRich(root, { mermaid = false } = {}) {
  // ```math blocks arrive as <pre><code data-math-style>; typeset them, don't treat them as code.
  for (const code of $$("pre > code[data-math-style]", root)) {
    const block = document.createElement("div");
    block.className = "math-block";
    block.dataset.mathStyle = "display";
    block.textContent = code.textContent;
    code.parentElement.replaceWith(block);
  }
  for (const n of $$("[data-math-style]:not(.math-done)", root)) lazyRender(n);
  for (const pre of $$("pre", root)) {
    if (pre.parentElement?.classList.contains("code-block")) continue;
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.append(pre);
    // Info strings like "ts#index.ts" name the file after the language.
    const info = ($("code", pre)?.className.match(/language-(\S+)/) || [])[1] || "";
    const [, lang, file] = info.match(/^(.*?)(?:#(.+))?$/);
    if (mermaid && lang === "mermaid") {
      wrap.classList.add("mermaid-block");
      wrap.dataset.src = pre.textContent;
      lazyRender(wrap);
      continue;
    }
    const tools = document.createElement("div");
    tools.className = "code-tools";
    tools.innerHTML = `<span class="code-lang"></span><button class="icon-btn" data-tip="Copy code" aria-label="Copy code">${svg("copy")}</button>`;
    $(".code-lang", tools).textContent = file || lang;
    if (file) $(".code-lang", tools).title = lang;
    $("button", tools).onclick = async (e) => {
      await navigator.clipboard.writeText(pre.innerText);
      const use = $("use", e.currentTarget);
      use.setAttribute("href", "#i-check");
      setTimeout(() => use.setAttribute("href", "#i-copy"), 1200);
    };
    wrap.append(tools);
  }
  for (const table of $$("table", root)) {
    if (table.parentElement?.classList.contains("table-wrap")) continue;
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
}

function decoratePreview(root) {
  for (const a of $$("a[href]", root)) {
    if (/^(https?:|mailto:)/i.test(a.getAttribute("href"))) a.classList.add("external");
  }
  for (const img of $$("img[src]", root)) {
    const src = img.getAttribute("src");
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !src.startsWith("file:")) continue;
    try { img.src = convertFileSrc(resolveLocal(src)); } catch { /* leave the broken image as-is */ }
  }
  for (const box of $$('li > input[type="checkbox"]', root)) box.disabled = false; // clicking one edits the source
  decorateRich(root, { mermaid: true });
}

// ---------- lazy typesetting ----------
// Typesetting every formula/diagram up front cost ~0.6 s at launch on a math-heavy note; only
// those near the viewport are drawn, the rest as they scroll in (or all at once before printing).
const lazyPending = new Set();
const renderRich = (n) => (n.classList.contains("mermaid-block") ? renderMermaid(n) : renderMath([n]));
const lazyObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazyObserver.unobserve(e.target);
    lazyPending.delete(e.target);
    renderRich(e.target);
  }
  // Re-renders while typing replace nodes before they are seen; drop the detached ones.
  if (lazyPending.size > 500) {
    for (const n of lazyPending) if (!n.isConnected) { lazyObserver.unobserve(n); lazyPending.delete(n); }
  }
}, { rootMargin: "800px 0px" });
function lazyRender(n) {
  lazyPending.add(n);
  lazyObserver.observe(n);
}
function renderAllPending() {
  const nodes = [...lazyPending].filter((n) => n.isConnected);
  for (const n of lazyPending) lazyObserver.unobserve(n);
  lazyPending.clear();
  return Promise.all(nodes.map(renderRich));
}

// ---------- math (KaTeX, loads with the first formula) ----------
let katexLib = null;
function loadKatex() {
  return katexLib ||= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/katex/katex.min.css";
    const s = document.createElement("script");
    s.src = "vendor/katex/katex.min.js";
    s.onload = () => resolve(window.katex);
    s.onerror = () => { katexLib = null; s.remove(); css.remove(); reject(new Error("Couldn't load the KaTeX renderer.")); };
    document.head.append(css, s);
  });
}

async function renderMath(nodes) {
  if (!nodes.length) return;
  let katex;
  try { katex = await loadKatex(); } catch { return; } // the TeX source stays visible
  for (const n of nodes) {
    if (n.classList.contains("math-done")) continue;
    const tex = n.textContent;
    try {
      katex.render(tex, n, { displayMode: n.dataset.mathStyle === "display", throwOnError: false, errorColor: "var(--danger)" });
      n.title = tex;
      n.classList.add("math-done");
    } catch { n.textContent = tex; }
  }
}

// ---------- mermaid (~5 MB, so it loads with the first diagram, never at startup) ----------
let mermaidLib = null;
let mermaidTheme = ""; // theme the library was last initialized for
let mermaidSeq = 0;
function loadMermaid() {
  return mermaidLib ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/mermaid.min.js";
    s.onload = () => resolve(window.mermaid);
    s.onerror = () => { mermaidLib = null; s.remove(); reject(new Error("Couldn't load the Mermaid renderer.")); };
    document.head.append(s);
  });
}

async function renderMermaid(block) {
  let id = "";
  try {
    const m = await loadMermaid();
    const key = `${el.root.dataset.theme}|${el.root.dataset.palette}|${el.root.dataset.accent}`;
    if (key !== mermaidTheme) {
      const css = getComputedStyle(el.root);
      const v = (name) => css.getPropertyValue(name).trim();
      m.initialize({
        startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: v("--font-view"),
        themeVariables: {
          darkMode: el.root.dataset.theme === "dark", background: v("--bg-app"), fontFamily: v("--font-view"),
          primaryColor: v("--bg-card"), primaryTextColor: v("--text-primary"), primaryBorderColor: v("--accent"),
          secondaryColor: v("--bg-field"), tertiaryColor: v("--bg-inset"), lineColor: v("--text-secondary"),
          textColor: v("--text-primary"), noteBkgColor: v("--bg-field"), noteTextColor: v("--text-primary"),
        },
      });
      mermaidTheme = key;
    }
    id = `mermaid-${++mermaidSeq}`;
    const { svg: out } = await m.render(id, block.dataset.src);
    if (!block.isConnected) return; // replaced by a newer render meanwhile
    block.innerHTML = out;
    block.classList.remove("mermaid-error");
  } catch (err) {
    document.getElementById(`d${id}`)?.remove(); // Mermaid can leave its scratch node behind on a parse error
    // Keep the source visible and say why it didn't draw.
    const pre = document.createElement("pre");
    pre.textContent = block.dataset.src;
    const msg = document.createElement("div");
    msg.className = "mermaid-msg";
    msg.textContent = String(err?.message || err).split("\n")[0];
    block.replaceChildren(msg, pre);
    block.classList.add("mermaid-error");
  }
}

function showDoc() {
  el.welcome.hidden = true;
  el.history.hidden = true;
  el.doc.hidden = false;
  el.status.hidden = false;
  el.tbDoc.hidden = false;
  setMode(state.mode);
  updateChrome();
  renderSidebar();
}

function setMode(mode) {
  const ratio = scrollRatio(state.mode === "edit" ? el.editor : el.previewPane);
  state.mode = mode;
  store.set("mode", mode);
  el.doc.dataset.mode = mode;
  for (const b of $$("button", el.modeSeg)) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  // Keep reading position when switching panes.
  setScrollRatio(el.editor, ratio);
  setScrollRatio(el.previewPane, ratio);
  if (mode !== "read") el.editor.focus({ preventScroll: true });
  if (mode !== "edit" && state.path) renderPreview(); // catch up on edits made in edit mode
  updatePos();
  if (mode === "read") setReplace(false); // replacing needs the source
  if (!el.findbar.hidden) runFind(el.findInput.value, { scroll: false }); // read mode searches the preview, the others the source
}

let shownDirty = false;
function updateChrome() {
  const name = state.path ? baseName(state.path) : state.untitled ? "Untitled" : "Markdown";
  shownDirty = isDirty();
  el.docName.textContent = name;
  el.docName.title = state.path || "";
  el.dirty.hidden = !shownDirty;
  el.win.toggleAttribute("data-dirty", shownDirty); // marks the open file in the sidebar
  document.title = `${shownDirty ? "• " : ""}${name}`;
  el.stPath.textContent = state.path ? prettyDir(state.path) + state.sep + name : "";
  el.stPath.title = state.path || "";
  updateStatus();
  updateAiChrome();
}

function updateStatus() {
  updateWords();
  updatePos();
}

function updateWords() {
  const words = (state.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  el.stWords.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`;
}

function updatePos() {
  if (state.mode !== "read") {
    const v = el.editor.value;
    const at = el.editor.selectionStart;
    let line = 1;
    for (let i = v.indexOf("\n"); i !== -1 && i < at; i = v.indexOf("\n", i + 1)) line++;
    const col = at - (at ? v.lastIndexOf("\n", at - 1) : -1);
    el.stPos.textContent = `Ln ${line}, Col ${col}`;
  } else {
    el.stPos.textContent = "";
  }
  if (isDirty()) el.stSave.textContent = "Unsaved changes";
  else if (!el.stSave.innerHTML.includes("svg")) el.stSave.textContent = "";
}

// ---------- editor ----------
// Typing does the minimum synchronously; the preview follows live (saved on Ctrl S, or by Autosave when it is on).
const wordsSoon = debounce(updateWords, 400);
const findSoon = debounce(() => runFind(el.findInput.value, { keepIndex: true, scroll: false }), 150);
const renderSoon = debounce(renderPreview, 120); // bursts of typing coalesce into one render
// Untitled buffers are skipped: saving them opens a file dialog.
const autosaveSoon = debounce(() => { if (state.settings.autosave === "on" && state.path && isDirty()) save(); }, 1500);
const outlineSoon = debounce(() => { if (outlineKeyOf(scanSource(state.text).headings) !== outlineKey) renderSidebar(); }, 400);
function editorChanged() {
  state.text = el.editor.value;
  driver = el.editor;
  if (isDirty() !== shownDirty) updateChrome();
  if (state.mode === "split") renderSoon(); // read mode re-renders on switch, edit mode has no preview
  wordsSoon();
  outlineSoon();
  autosaveSoon();
  if (!el.findbar.hidden) findSoon();
}
el.editor.addEventListener("input", () => { if (!restoring) recordEdit(); editorChanged(); });
el.editor.addEventListener("keyup", updatePos);
el.editor.addEventListener("scroll", () => { el.editorHl.scrollTop = el.editor.scrollTop; });
el.editor.addEventListener("click", updatePos);
// Typing one of these over a selection wraps it instead of replacing it.
const WRAP_PAIRS = { "*": "*", "_": "_", "`": "`", "~": "~", "(": ")", "[": "]", "{": "}", '"': '"' };

/** Wraps the selection in open/close. With `toggle`, an already-wrapped selection is unwrapped. `select` picks a placeholder inside `close`. */
function wrapSelection(open, close = open, { toggle = true, select = null } = {}) {
  if (state.mode === "read") return;
  const v = el.editor.value;
  const s = el.editor.selectionStart;
  const e = el.editor.selectionEnd;
  const inner = v.slice(s, e);
  if (toggle && s >= open.length && v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
    editRange(s - open.length, e + close.length, inner);
    el.editor.setSelectionRange(s - open.length, e - open.length);
  } else {
    editRange(s, e, open + inner + close);
    const at = select ? e + open.length + close.indexOf(select) : s + open.length;
    el.editor.setSelectionRange(at, select ? at + select.length : e + open.length);
  }
  updatePos();
}

/** Indents (or outdents) every line the selection touches by two spaces. */
function indentLines(out) {
  const v = el.editor.value;
  const s = el.editor.selectionStart;
  const e = el.editor.selectionEnd;
  const ls = s ? v.lastIndexOf("\n", s - 1) + 1 : 0;
  const end = e > s && v[e - 1] === "\n" ? e - 1 : e; // a selection ending at a line start doesn't include that line
  const block = v.slice(ls, end);
  const next = out ? block.replace(/^( {1,2}|\t)/gm, "") : block.replace(/^(?=.)/gm, "  ");
  if (next === block) return;
  editRange(ls, end, next);
  if (s === e) { const at = Math.max(ls, s + next.length - block.length); el.editor.setSelectionRange(at, at); }
  else el.editor.setSelectionRange(ls, ls + next.length);
}

el.editor.addEventListener("keydown", (e) => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;
  const k = e.key.toLowerCase();
  const s = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  if (e.key === "Tab" && plain) {
    e.preventDefault();
    if (e.shiftKey || el.editor.value.slice(s, end).includes("\n")) indentLines(e.shiftKey);
    else document.execCommand("insertText", false, "  ");
  } else if (e.key === "Enter" && plain && !e.shiftKey && s === end) {
    // Continue lists, task lists, quotes, and indentation; Enter on an empty item ends the list.
    const v = el.editor.value;
    const ls = s ? v.lastIndexOf("\n", s - 1) + 1 : 0;
    const c = continuation(v.slice(ls, s)); // mdsource.js
    if (c?.insert) { e.preventDefault(); document.execCommand("insertText", false, "\n" + c.insert); }
    else if (c?.clear && (s === v.length || v[s] === "\n")) { e.preventDefault(); editRange(ls, s, ""); }
  } else if (plain && s !== end && WRAP_PAIRS[e.key]) {
    e.preventDefault();
    wrapSelection(e.key, WRAP_PAIRS[e.key], { toggle: false });
  } else if (mod && k === "i") {
    e.preventDefault();
    wrapSelection("*");
  } else if (mod && k === "k") {
    e.preventDefault();
    wrapSelection("[", "](url)", { toggle: false, select: "url" });
  } else if (mod && k === "b" && !e.shiftKey && s !== end) { // with nothing selected, Ctrl B still toggles the sidebar
    e.preventDefault();
    e.stopPropagation();
    wrapSelection("**");
  } else if (mod && k === "z") {
    e.preventDefault();
    stepHistory(e.shiftKey ? 1 : -1);
  } else if (mod && k === "y") {
    e.preventDefault();
    stepHistory(1);
  }
});

// Undo/redo: WebKitGTK's native textarea undo doesn't work in this window, so the editor keeps
// its own history. Typing within 600 ms of the previous edit merges into one undo step.
// ponytail: whole-text snapshots capped at 200; store diffs instead if very large files make it heavy.
const edits = { stack: [], at: 0, lastEdit: 0 };
let restoring = false; // an undo/redo is writing to the editor; don't record it as a new edit
const snapshot = () => ({ text: el.editor.value, start: el.editor.selectionStart, end: el.editor.selectionEnd });
function resetHistory() {
  edits.stack = [snapshot()];
  edits.at = 0;
  edits.lastEdit = 0;
}
function recordEdit() {
  const now = Date.now();
  const merge = now - edits.lastEdit < 600 && edits.at > 0 && edits.at === edits.stack.length - 1;
  edits.lastEdit = now;
  edits.stack.length = edits.at + 1; // a new edit drops the redo branch
  if (merge) { edits.stack[edits.at] = snapshot(); return; }
  edits.stack.push(snapshot());
  if (edits.stack.length > 200) edits.stack.shift();
  edits.at = edits.stack.length - 1;
}
function stepHistory(dir) {
  const s = edits.stack[edits.at + dir];
  if (!s) return;
  edits.at += dir;
  edits.lastEdit = 0; // the next keystroke starts a fresh step
  // Retype only the span that differs, like a keystroke would: WebKit then scrolls to the edit
  // only if it is off-screen. (Assigning .value, or blur()+focus() after a change, puts the
  // caret at the end of the text and scrolls to the bottom.)
  const cur = el.editor.value;
  const max = Math.min(cur.length, s.text.length);
  let a = 0;
  while (a < max && cur[a] === s.text[a]) a++;
  let b = 0;
  while (b < max - a && cur[cur.length - 1 - b] === s.text[s.text.length - 1 - b]) b++;
  const insert = s.text.slice(a, s.text.length - b);
  if (cur !== s.text) { // an empty range with "delete" would eat the char before the caret
    el.editor.setSelectionRange(a, cur.length - b);
    restoring = true;
    try {
      document.execCommand(insert ? "insertText" : "delete", false, insert); // fires input -> editorChanged
    } finally {
      restoring = false;
    }
    if (el.editor.value !== s.text) { el.editor.value = s.text; editorChanged(); } // safety net, never expected
  }
  el.editor.setSelectionRange(s.start, s.end);
  updatePos();
}

// Split view scroll sync, by ratio. Only the pane the user is driving pushes its position:
// syncing both ways ping-pongs (WebKitGTK delivers the follower's scroll event a frame late),
// and pixel rounding on each hop made the panes keep creeping after scrolling stopped.
const scrollRatio = (n) => n.scrollTop / Math.max(1, n.scrollHeight - n.clientHeight);
const setScrollRatio = (n, r) => { n.scrollTop = r * (n.scrollHeight - n.clientHeight); };
let driver = el.editor;
for (const [from, to] of [[el.editor, el.previewPane], [el.previewPane, el.editor]]) {
  for (const type of ["wheel", "pointerdown", "keydown"]) from.addEventListener(type, () => { driver = from; }, { passive: true });
  from.addEventListener("scroll", () => {
    if (state.mode === "split" && driver === from) setScrollRatio(to, scrollRatio(from));
  });
}

// ---------- links ----------
function scrollToFragment(frag) {
  const id = decodeURIComponent(frag);
  const target = el.preview.querySelector(`[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
  if (target) {
    if (state.mode === "edit") setMode("read");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

el.preview.addEventListener("click", async (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href.startsWith("#")) return scrollToFragment(href.slice(1));
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) {
    return opener.openUrl(href).catch(() => toast("Couldn't open that link.", "error"));
  }
  const [rawPath, fragment = null] = href.split("#");
  if (!rawPath) return;
  const abs = resolveLocal(rawPath);
  if (MD_RE.test(abs)) return openFile(abs, { fragment });
  opener.openPath(abs).catch(() => toast(`Couldn't open “${baseName(abs)}”.`, "error"));
});

// ---------- find & replace ----------
// Read mode searches the rendered preview; split and edit modes search the Markdown source,
// which is also what replace edits. Source matches are painted by .editor-hl behind the textarea.
const find = { marks: [], hl: [], hits: [], index: -1, bad: false, opts: { matchCase: false, word: false, regex: false } };
const findsSource = () => state.mode !== "read";
const findTotal = () => (findsSource() ? find.hits.length : find.marks.length);

function findRegex(query) {
  const { matchCase, word, regex } = find.opts;
  let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (word) src = `\\b(?:${src})\\b`;
  try { return new RegExp(src, matchCase ? "gm" : "gim"); } catch { return null; }
}

function* matchesIn(re, text) {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) {
    if (m[0]) yield m;
    else re.lastIndex++; // empty match: step past it
  }
}

function clearFindMarks() {
  for (const m of find.marks) m.replaceWith(document.createTextNode(m.textContent));
  if (find.marks.length) el.preview.normalize();
  find.marks = [];
}

function markPreview(re) {
  const walker = document.createTreeWalker(el.preview, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement.closest(".code-tools, svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const made = [];
    for (const m of [...matchesIn(re, node.data)].reverse()) { // back to front keeps earlier offsets valid
      node.splitText(m.index + m[0].length);
      const hit = node.splitText(m.index);
      const mark = document.createElement("mark");
      mark.className = "find";
      hit.replaceWith(mark);
      mark.append(hit);
      made.push(mark);
    }
    find.marks.push(...made.reverse());
  }
}

function renderHl() {
  find.hl = [];
  if (!findsSource() || !find.hits.length) { el.editorHl.textContent = ""; return; }
  let html = "";
  let pos = 0;
  for (const h of find.hits) {
    html += `${escapeHtml(state.text.slice(pos, h.start))}<mark>${escapeHtml(state.text.slice(h.start, h.end))}</mark>`;
    pos = h.end;
  }
  el.editorHl.innerHTML = `${html}${escapeHtml(state.text.slice(pos))}​`; // zero-width char keeps a trailing newline's height
  find.hl = [...el.editorHl.children];
  el.editorHl.scrollTop = el.editor.scrollTop;
}

/** Index of the match to start on for a sidebar hit on `line`: the first one at or after it. */
function matchNearLine(re, line) {
  let at = 0;
  for (let i = 1; i < line; i++) {
    const nl = state.text.indexOf("\n", at);
    if (nl < 0) { at = state.text.length; break; }
    at = nl + 1;
  }
  const starts = findsSource() ? find.hits.map((h) => h.start) : [...matchesIn(re, state.text)].map((m) => m.index);
  const i = starts.findIndex((s) => s >= at);
  // The preview shows less text than the source (URLs, fences), so there the Nth match is a best guess.
  return Math.max(0, i < 0 ? starts.length - 1 : i);
}

function runFind(query, { keepIndex = false, scroll = true, line = null, at = null } = {}) {
  const prev = find.index;
  clearFindMarks();
  find.hits = [];
  find.index = -1;
  const re = query ? findRegex(query) : null;
  find.bad = Boolean(query) && !re;
  if (re) {
    if (findsSource()) find.hits = [...matchesIn(re, state.text)].map((m) => ({ start: m.index, end: m.index + m[0].length, m }));
    else markPreview(re);
  }
  renderHl();
  const total = findTotal();
  if (!total) return updateFindCount();
  let i = keepIndex && prev >= 0 ? Math.min(prev, total - 1) : 0;
  if (at !== null) i = Math.max(0, find.hits.findIndex((h) => h.start >= at));
  else if (line !== null) i = matchNearLine(re, line);
  gotoMatch(i, scroll);
}

function gotoMatch(i, scroll = true) {
  const total = findTotal();
  if (!total) return;
  find.index = (i + total) % total;
  if (findsSource()) {
    find.hl.forEach((m, j) => m.classList.toggle("current", j === find.index));
    driver = el.editor;
    const m = find.hl[find.index];
    const view = el.editor.clientHeight;
    const off = m.offsetTop - el.editor.scrollTop;
    if (scroll && (off < 48 || off + m.offsetHeight > view - 48)) el.editor.scrollTop = Math.max(0, m.offsetTop - view / 2);
  } else {
    find.marks.forEach((m, j) => m.classList.toggle("current", j === find.index));
    driver = el.previewPane;
    if (scroll) find.marks[find.index].scrollIntoView({ block: "center" });
  }
  updateFindCount();
}

function updateFindCount() {
  const total = findTotal();
  const q = el.findInput.value;
  el.findCount.textContent = !q ? "" : find.bad ? "Invalid" : total ? `${find.index + 1} of ${total}` : "No results";
  el.findCount.classList.toggle("none", Boolean(q) && !total);
}

function setReplace(open) {
  if (open && state.mode === "read") setMode("split");
  el.replaceRow.hidden = !open;
  el.findToggle.setAttribute("aria-expanded", String(open));
}

function syncFindOpts() {
  for (const b of $$("[data-opt]", el.findbar)) b.setAttribute("aria-pressed", String(find.opts[b.dataset.opt]));
}

function openFind(query, { line = null, replace = false } = {}) {
  if (!state.path) return;
  el.findbar.hidden = false;
  if (line !== null) { // a sidebar content hit is a plain-text query
    find.opts = { matchCase: false, word: false, regex: false };
    syncFindOpts();
  }
  const sel = query ?? (document.activeElement === el.editor
    ? el.editor.value.slice(el.editor.selectionStart, el.editor.selectionEnd).trim()
    : window.getSelection().toString().trim());
  if (sel && !sel.includes("\n")) el.findInput.value = sel;
  if (replace) setReplace(true);
  el.findInput.focus();
  el.findInput.select();
  runFind(el.findInput.value, { line });
}

function closeFind() {
  const hit = findsSource() && find.hits[find.index];
  el.findbar.hidden = true;
  clearFindMarks();
  find.hits = [];
  find.index = -1;
  renderHl();
  if (hit && state.path) { // leave the match selected, like VS Code
    el.editor.focus({ preventScroll: true });
    el.editor.setSelectionRange(hit.start, hit.end);
  }
}

/** Types `text` over [start, end) as the user would, so undo and the preview follow. */
function editRange(start, end, text) {
  el.editor.focus({ preventScroll: true });
  el.editor.setSelectionRange(start, end);
  document.execCommand(text ? "insertText" : "delete", false, text);
}

/** An edit made from the preview (a task checkbox): works in read mode too and leaves both panes where they are. */
function applyEdit(start, end, text) {
  if (state.mode === "read") { // the hidden editor can't take typed input
    el.editor.value = state.text.slice(0, start) + text + state.text.slice(end);
    recordEdit();
    editorChanged();
    renderPreview();
  } else {
    const top = el.editor.scrollTop;
    editRange(start, end, text);
    el.editor.scrollTop = top;
    driver = el.previewPane; // the editor's scroll event must not drag the preview along
  }
}

// ---------- outline ----------
let outlineKey = ""; // headings shown in the sidebar, to skip re-rendering it while typing body text
const outlineKeyOf = (heads) => heads.map((h) => h.level + h.text).join("\n");

/** Scrolls the editor so `offset` is near the top, measured with the find mirror (textareas have no API for it). */
function scrollEditorTo(offset) {
  el.editorHl.innerHTML = `${escapeHtml(state.text.slice(0, offset))}<mark>​</mark>`;
  el.editor.scrollTop = Math.max(0, el.editorHl.firstElementChild.offsetTop - 48);
  renderHl();
  if (find.index >= 0) gotoMatch(find.index, false);
}

async function gotoHeading(i) {
  const heads = scanSource(state.text).headings; // mdsource.js
  const h = heads[i];
  if (!h) return;
  if (state.mode === "edit") {
    el.editor.focus({ preventScroll: true });
    el.editor.setSelectionRange(h.offset, h.offset);
    scrollEditorTo(h.offset);
    return updatePos();
  }
  await renderPreview();
  const shown = $$("h1, h2, h3, h4, h5, h6", el.preview);
  // The source scan and the renderer can disagree (setext or HTML headings): then go by text.
  const target = shown.length === heads.length ? shown[i] : shown.find((n) => n.textContent.trim() === h.text);
  if (!target) return;
  driver = el.previewPane;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

el.preview.addEventListener("click", (e) => {
  const box = e.target.closest('li > input[type="checkbox"]');
  if (!box) return;
  const boxes = $$('li > input[type="checkbox"]', el.preview);
  const { tasks } = scanSource(state.text);
  const at = tasks[boxes.indexOf(box)];
  if (tasks.length !== boxes.length || at === undefined) {
    box.checked = !box.checked;
    return toast("Couldn't find this task in the source. Edit it in the editor instead.", "error");
  }
  applyEdit(at, at + 1, state.text[at] === " " ? "x" : " ");
});

function replacement(hit) {
  const r = el.replaceInput.value;
  if (!find.opts.regex) return r;
  return r.replace(/\$([$&]|\d{1,2}|<(\w+)>)|\\([nt])/g, (s, t, name, esc) => {
    if (esc) return esc === "n" ? "\n" : "\t";
    if (t === "$") return "$";
    if (t === "&") return hit.m[0];
    if (name) return hit.m.groups?.[name] ?? "";
    return +t < hit.m.length ? hit.m[+t] ?? "" : s;
  });
}

function replaceHits(hits) {
  if (!hits.length) return;
  const first = hits[0].start;
  const last = hits.at(-1).end;
  let out = "";
  let pos = first;
  for (const h of hits) {
    out += state.text.slice(pos, h.start) + replacement(h);
    pos = h.end;
  }
  editRange(first, last, out);
}

function replaceOne() {
  const hit = find.hits[find.index];
  if (!findsSource() || !hit) return;
  const next = hit.start + replacement(hit).length;
  replaceHits([hit]);
  runFind(el.findInput.value, { at: next });
  el.replaceInput.focus();
}

function replaceAll() {
  const n = find.hits.length;
  if (!findsSource() || !n) return;
  const top = el.editor.scrollTop;
  replaceHits(find.hits);
  el.editor.scrollTop = top;
  runFind(el.findInput.value, { keepIndex: true, scroll: false });
  el.replaceInput.focus();
  toast(`Replaced ${n} ${n === 1 ? "match" : "matches"}.`);
}

el.findInput.addEventListener("input", debounce(() => runFind(el.findInput.value), 120));
el.findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); gotoMatch(find.index + (e.shiftKey ? -1 : 1)); }
  if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
el.replaceInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); (e.ctrlKey && e.altKey ? replaceAll : replaceOne)(); }
  if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});

// ---------- sidebar ----------
function navItem({ path, name, sub, current, tile = true, extra = "", attrs = "" }) {
  return `<div class="nav-item" role="button" tabindex="0" data-path="${escapeHtml(path)}" ${attrs}
      ${current ? 'aria-current="true"' : ""} title="${escapeHtml(path)}">
    ${tile ? `<span class="icon-tile" style="--tile:${tileColor(path)}">${svg("file")}</span>` : ""}
    <span class="nav-text"><span class="nav-name">${escapeHtml(name)}</span>${sub ? `<span class="nav-sub">${sub}</span>` : ""}</span>
    ${extra}
  </div>`;
}

function treeHtml(nodes, depth) {
  return nodes.map((n) => {
    const pad = `style="padding-left:${8 + depth * 14}px"`;
    if (!n.children) {
      return `<div class="nav-item tree-item" role="treeitem" tabindex="0" data-path="${escapeHtml(n.path)}" ${pad}
        ${n.path === state.path ? 'aria-current="true"' : ""} title="${escapeHtml(n.path)}">
        <span class="chev-space"></span><svg class="ico"><use href="#i-file"/></svg><span class="nav-name">${escapeHtml(n.name)}</span></div>`;
    }
    const open = state.expanded.has(n.path);
    return `<div class="nav-item tree-item" role="treeitem" tabindex="0" data-dir="${escapeHtml(n.path)}" aria-expanded="${open}" ${pad}>
        <svg class="chev"><use href="#i-chevron"/></svg><svg class="ico folder"><use href="#i-folder"/></svg>
        <span class="nav-name">${escapeHtml(n.name)}</span></div>${open ? treeHtml(n.children, depth + 1) : ""}`;
  }).join("");
}

function renderSidebar() {
  if (el.sbSearch.value.trim()) return; // search results own the list while a query is active
  let html = "";
  const heads = state.path || state.untitled ? scanSource(state.text).headings : [];
  outlineKey = outlineKeyOf(heads);
  if (heads.length) {
    const open = store.get("outlineOpen", true);
    const top = Math.min(...heads.map((h) => h.level));
    html += `<div class="group-label"><span>Outline</span>
      <button class="icon-btn" data-action="toggle-outline" aria-expanded="${open}" data-tip="${open ? "Collapse" : "Expand"}" aria-label="Toggle outline">${svg(open ? "up" : "down")}</button></div>`;
    if (open) html += heads.map((h, i) => `<div class="nav-item tree-item outline-item" role="button" tabindex="0" data-heading="${i}"
      style="padding-left:${10 + (h.level - top) * 12}px" title="${escapeHtml(h.text)}"><span class="nav-name">${escapeHtml(h.text)}</span></div>`).join("");
  }
  // The sidebar shows the latest few; History has the rest.
  html += `<div class="group-label"><span>Recent</span>${state.recents.length > SIDEBAR_RECENTS
    ? `<button class="icon-btn" data-action="history" data-tip="All ${state.recents.length} recent files" aria-label="Open history">${svg("clock")}</button>` : ""}</div>`;
  html += state.recents.length
    ? state.recents.slice(0, SIDEBAR_RECENTS).map((p) => navItem({
        path: p, name: baseName(p), sub: escapeHtml(prettyDir(p)), current: p === state.path,
        extra: `<span class="nav-remove" data-remove="${escapeHtml(p)}" role="button" aria-label="Remove from recent" data-tip="Remove from list">${svg("x")}</span>`,
      })).join("")
    : `<div class="sb-empty">Files you open will appear here.</div>`;
  if (state.folder) {
    html += `<div class="group-label"><span title="${escapeHtml(state.folder)}">${escapeHtml(baseName(state.folder))}</span>
      <button class="icon-btn" data-action="refresh-folder" data-tip="Refresh" aria-label="Refresh folder">${svg("refresh")}</button>
      <button class="icon-btn" data-action="close-folder" data-tip="Close folder" aria-label="Close folder">${svg("x")}</button></div>`;
    html += state.tree.length ? `<div role="tree">${treeHtml(state.tree, 0)}</div>` : `<div class="sb-empty">No Markdown files in this folder.</div>`;
  }
  el.sbList.innerHTML = html;
}

async function runSearch() {
  const q = el.sbSearch.value.trim();
  el.sbClear.hidden = !el.sbSearch.value;
  if (!q) return renderSidebar();
  const files = [...new Set([...state.recents, ...folderFiles()])];
  const lower = q.toLowerCase();
  const byName = files.filter((p) => baseName(p).toLowerCase().includes(lower)).slice(0, 20);
  const hits = await invoke("search_files", { paths: files, query: q });
  if (el.sbSearch.value.trim() !== q) return; // stale
  let html = "";
  if (byName.length) {
    html += `<div class="group-label"><span>Files</span></div>`;
    html += byName.map((p) => navItem({ path: p, name: baseName(p), sub: escapeHtml(prettyDir(p)), current: p === state.path })).join("");
  }
  if (hits.length) {
    html += `<div class="group-label"><span>In contents · ${hits.length}${hits.length === 200 ? "+" : ""}</span></div>`;
    html += hits.map((h) => navItem({
      path: h.path, name: baseName(h.path), attrs: `data-find="${escapeHtml(q)}" data-line="${h.line}"`,
      sub: `<span class="nav-line">${h.line}</span>${highlight(h.text, q)}`,
    })).join("");
  }
  el.sbList.innerHTML = html || `<div class="sb-empty">No results for “${escapeHtml(q)}”.<br>Try a different word.</div>`;
}

el.sbSearch.addEventListener("input", debounce(runSearch, 200));
el.sbSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { el.sbSearch.value = ""; runSearch(); }
  if (e.key === "ArrowDown") { e.preventDefault(); $(".nav-item", el.sbList)?.focus(); }
});

function activateNav(item) {
  if (item.dataset.heading) {
    gotoHeading(Number(item.dataset.heading));
    if (el.win.dataset.sidebar === "overlay") el.win.dataset.sidebar = "";
  } else if (item.dataset.dir) {
    const d = item.dataset.dir;
    state.expanded.has(d) ? state.expanded.delete(d) : state.expanded.add(d);
    renderSidebar();
    $(`[data-dir="${CSS.escape(d)}"]`, el.sbList)?.focus();
  } else if (item.dataset.path) {
    openFile(item.dataset.path, { find: item.dataset.find || null, line: item.dataset.line ? Number(item.dataset.line) : null });
    if (el.win.dataset.sidebar === "overlay") el.win.dataset.sidebar = "";
  }
}

el.sbList.addEventListener("click", (e) => {
  const remove = e.target.closest("[data-remove]");
  if (remove) return removeRecent(remove.dataset.remove);
  const item = e.target.closest(".nav-item");
  if (item) activateNav(item);
});
el.sbList.addEventListener("keydown", (e) => {
  const item = e.target.closest(".nav-item");
  if (!item) return;
  const items = $$(".nav-item", el.sbList);
  const i = items.indexOf(item);
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateNav(item); }
  else if (e.key === "ArrowDown") { e.preventDefault(); items[i + 1]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || el.sbSearch).focus(); }
  else if (item.dataset.dir && (e.key === "ArrowRight") !== state.expanded.has(item.dataset.dir) && /Arrow(Left|Right)/.test(e.key)) activateNav(item);
  else if (e.key === "Delete" && state.recents.includes(item.dataset.path) && !item.classList.contains("tree-item")) removeRecent(item.dataset.path);
});

// ---------- sidebar context menu ----------
let menuRuns = [];

async function revealPath(p) {
  try {
    await opener.revealItemInDir(p);
  } catch { // no file manager service: open the folder itself
    opener.openPath(dirName(p)).catch(() => toast("Couldn't open that folder.", "error"));
  }
}

async function pdfOf(p) {
  if (await openFile(p)) exportPdf();
}

function hideMenu() { el.menu.hidden = true; }

function showMenu(item, x, y) {
  const p = item.dataset.path || item.dataset.dir;
  const entries = [["Open containing folder", "folder", () => revealPath(p)]];
  if (item.dataset.path) entries.push(["Convert to PDF", "pdf", () => pdfOf(p)]);
  menuRuns = entries.map((e) => e[2]);
  el.menu.innerHTML = entries.map(([label, icon], i) => `<button role="menuitem" data-i="${i}">${svg(icon)}${label}</button>`).join("");
  el.menu.hidden = false;
  el.menu.style.left = `${Math.max(4, Math.min(x, innerWidth - el.menu.offsetWidth - 4))}px`;
  el.menu.style.top = `${Math.max(4, Math.min(y, innerHeight - el.menu.offsetHeight - 4))}px`;
  $("button", el.menu).focus();
}

el.sbList.addEventListener("contextmenu", (e) => {
  const item = e.target.closest(".nav-item");
  if (!item || !(item.dataset.path || item.dataset.dir)) return;
  e.preventDefault();
  const r = item.getBoundingClientRect();
  const keyboard = !e.clientX && !e.clientY; // the Menu key reports no pointer position
  showMenu(item, keyboard ? r.left + 16 : e.clientX, keyboard ? r.bottom : e.clientY);
});
el.menu.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  hideMenu();
  menuRuns[Number(b.dataset.i)]();
});
el.menu.addEventListener("keydown", (e) => {
  const items = $$("button", el.menu);
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
  else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
  else if (e.key === "Escape" || e.key === "Tab") hideMenu();
  else return;
  e.preventDefault();
  e.stopPropagation();
});
document.addEventListener("mousedown", (e) => { if (!e.target.closest(".ctx-menu")) hideMenu(); });
el.sbList.addEventListener("scroll", hideMenu);
addEventListener("blur", hideMenu);
addEventListener("resize", hideMenu);

// ---------- welcome & history ----------
function historyRow(p) {
  return `<div class="history-item">
    <button class="history-row" data-action="open-history" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">
      <span class="icon-tile" style="--tile:${tileColor(p)}">${svg("file")}</span>
      <span class="nav-text"><span class="nav-name">${escapeHtml(baseName(p))}</span><span class="nav-sub">${escapeHtml(prettyDir(p))}</span></span>
      ${svg("chevron")}</button>
    <button class="history-x" data-action="remove-history" data-path="${escapeHtml(p)}" data-tip="Remove from history" aria-label="Remove from history">${svg("x")}</button>
  </div>`;
}

function renderHistoryList(container) {
  container.innerHTML = state.recents.map(historyRow).join("");
}

function renderWelcome() {
  renderHistoryList(el.welcomeList);
  el.welcomeEmpty.hidden = state.recents.length > 0;
}

function renderHistory() {
  renderHistoryList(el.historyList);
  el.historyEmpty.hidden = state.recents.length > 0;
  el.historyCount.textContent = `${state.recents.length} ${state.recents.length === 1 ? "file" : "files"}`;
}

function openHistory() {
  el.welcome.hidden = true;
  el.doc.hidden = true;
  el.status.hidden = true;
  el.tbDoc.hidden = true;
  el.history.hidden = false;
  renderHistory();
}

function closeHistory() {
  el.history.hidden = true;
  if (state.path || state.untitled) showDoc();
  else { renderWelcome(); el.welcome.hidden = false; }
}

// ---------- sidebar layout ----------
const narrow = matchMedia("(max-width: 720px)");
function toggleSidebar() {
  if (narrow.matches) {
    el.win.dataset.sidebar = el.win.dataset.sidebar === "overlay" ? "" : "overlay";
  } else {
    el.win.dataset.sidebar = el.win.dataset.sidebar === "closed" ? "" : "closed";
    store.set("sidebarClosed", el.win.dataset.sidebar === "closed");
  }
}
narrow.addEventListener("change", () => {
  el.win.dataset.sidebar = !narrow.matches && store.get("sidebarClosed", false) ? "closed" : "";
});

el.splitter.addEventListener("pointerdown", (e) => {
  el.splitter.setPointerCapture(e.pointerId);
  el.splitter.classList.add("dragging");
  const left = el.sidebar.getBoundingClientRect().left;
  const move = (ev) => {
    const w = Math.round(Math.min(400, Math.max(200, ev.clientX - left)));
    el.root.style.setProperty("--sidebar-w", `${w}px`);
  };
  const up = () => {
    el.splitter.classList.remove("dragging");
    el.splitter.removeEventListener("pointermove", move);
    store.set("sidebarW", getComputedStyle(el.root).getPropertyValue("--sidebar-w").trim());
  };
  el.splitter.addEventListener("pointermove", move);
  el.splitter.addEventListener("pointerup", up, { once: true });
});
el.splitter.addEventListener("dblclick", () => {
  el.root.style.removeProperty("--sidebar-w");
  store.set("sidebarW", null);
});

// ---------- tooltips ----------
let tipTimer;
let tipShownAt = 0;
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  clearTimeout(tipTimer);
  if (!t) { if (!el.tooltip.hidden) { el.tooltip.hidden = true; tipShownAt = Date.now(); } return; }
  const delay = Date.now() - tipShownAt < 300 || !el.tooltip.hidden ? 0 : 500;
  tipTimer = setTimeout(() => {
    el.tooltip.innerHTML = escapeHtml(t.dataset.tip) + (t.dataset.key ? ` <kbd>${escapeHtml(t.dataset.key)}</kbd>` : "");
    el.tooltip.hidden = false;
    const r = t.getBoundingClientRect();
    const tr = el.tooltip.getBoundingClientRect();
    const below = r.bottom + 6 + tr.height < innerHeight;
    el.tooltip.style.top = `${below ? r.bottom + 6 : r.top - tr.height - 6}px`;
    el.tooltip.style.left = `${Math.min(innerWidth - tr.width - 8, Math.max(8, r.left + r.width / 2 - tr.width / 2))}px`;
  }, delay);
});
document.addEventListener("mousedown", () => { clearTimeout(tipTimer); el.tooltip.hidden = true; });

// ---------- actions ----------
const actions = {
  "toggle-sidebar": toggleSidebar,
  "open-file": pickFile,
  "open-folder": pickFolder,
  "refresh-folder": loadTree,
  "settings-reset": () => {
    state.settings = { ...DEFAULT_SETTINGS, aiEffort: state.settings.aiEffort, aiProvider: state.settings.aiProvider, aiModel: state.settings.aiModel, aiMemory: state.settings.aiMemory };
    applySettings();
    for (const input of $$("[data-font]", el.settingsDlg)) input.value = "";
  },
  "close-folder": () => { state.folder = null; store.set("folder", null); loadTree(); },
  "toggle-outline": () => { store.set("outlineOpen", !store.get("outlineOpen", true)); renderSidebar(); },
  "clear-search": () => { el.sbSearch.value = ""; runSearch(); el.sbSearch.focus(); },
  find: () => openFind(),
  "find-next": () => gotoMatch(find.index + 1),
  "find-prev": () => gotoMatch(find.index - 1),
  "find-close": closeFind,
  "find-replace": () => { setReplace(el.replaceRow.hidden); (el.replaceRow.hidden ? el.findInput : el.replaceInput).focus(); },
  "find-opt": (b) => { find.opts[b.dataset.opt] = !find.opts[b.dataset.opt]; syncFindOpts(); el.findInput.focus(); runFind(el.findInput.value); },
  "replace-one": replaceOne,
  "replace-all": replaceAll,
  pdf: exportPdf,
  settings: openSettings,
  "new-file": newFile,
  "new-window": newWindow,
  "save-as": saveAs,
  history: openHistory,
  "history-close": closeHistory,
  "open-history": (b) => openFile(b.dataset.path),
  "remove-history": (b) => removeRecent(b.dataset.path),
  "toggle-ai": toggleAiPanel,
  "ai-new": newAiChat,
  "ai-history": openAiHistory,
  "ai-history-close": closeAiHistory,
  "ai-rename": startAiRename,
  "ai-effort-menu": (b) => (el.aiMenu.hidden ? openAiEffortMenu(b) : closeAiEffortMenu()),
  "ai-stop": stopAi,
  "ai-add-provider": openProviderDialog,
  "ai-forget": (b) => changeAiMemory((memory) => { memory.items = memory.items.filter((item) => item.id !== b.dataset.id); }),
  "ai-clear-selection": () => { state.ai.selection = null; updateAiChrome(); el.aiInput.focus(); },
  "ai-clear-reply": () => { state.ai.reply = null; updateAiChrome(); el.aiInput.focus(); },
  "dialog-close": (b) => b.closest("dialog").close(),
  minimize: () => appWindow.minimize(),
  maximize: () => appWindow.toggleMaximize(),
  close: () => appWindow.close(),
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b && actions[b.dataset.action]) actions[b.dataset.action](b);
  const m = e.target.closest("[data-mode]");
  if (m && m.closest(".tb-doc")) setMode(m.dataset.mode);
});

async function exportPdf() {
  if (el.doc.hidden) return;
  closeFind();
  await renderPreview(); // make sure the printed preview matches the editor
  await renderAllPending(); // off-screen math and diagrams are drawn lazily
  try { await invoke("print_page"); } catch (err) { toast(`Couldn't open the print dialog. ${err}`, "error"); }
}

// ---------- command palette ----------
const PALETTE_GROUPS = ["File", "Editor", "View", "Mark", "Preferences", "Help", "Headings", "Files"];
const PALETTE_DYNAMIC_MAX = 8; // rows shown per Headings / Files group
let paletteMatches = [];
let paletteSel = 0;

function zoom(step) {
  const i = FONT_SIZES.indexOf(state.settings.fontSize);
  state.settings.fontSize = step ? FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, i + step))] : DEFAULT_SETTINGS.fontSize;
  applySettings();
}

/** Commands, plus (only while searching) the open document's headings and every known file. */
function paletteCommands(q) {
  const hasDoc = !!(state.path || state.untitled);
  const editing = hasDoc && state.mode !== "read";
  const found = !q ? [] : [
    ...(hasDoc ? scanSource(state.text).headings : []).map((h, i) => ({ group: "Headings", icon: "chevron", title: h.text, run: () => gotoHeading(i) })),
    ...[...new Set([...state.recents, ...folderFiles()])].filter((p) => p !== state.path)
      .map((p) => ({ group: "Files", icon: "file", title: baseName(p), sub: prettyDir(p), run: () => openFile(p) })),
  ];
  return [
    { group: "File", icon: "plus", title: "New File", key: "Ctrl N", keywords: "create blank untitled document", run: newFile },
    { group: "File", icon: "window", title: "New Window", key: "Ctrl Shift N", keywords: "another second instance blank", run: newWindow },
    { group: "File", icon: "file", title: "Open File", key: "Ctrl O", keywords: "browse load document", run: pickFile },
    { group: "File", icon: "folder-plus", title: "Open Folder", key: "Ctrl Shift O", keywords: "directory workspace tree", run: pickFolder },
    { group: "File", icon: "save", title: "Save", key: "Ctrl S", keywords: "write store disk", on: hasDoc, run: () => save().then((ok) => ok && toast("Saved")) },
    { group: "File", icon: "save", title: "Save As", keywords: "write store disk copy new name", on: hasDoc, run: saveAs },
    { group: "File", icon: "pdf", title: "Print / Export PDF", key: "Ctrl P", keywords: "print export pdf paper", on: hasDoc, run: exportPdf },
    { group: "File", icon: "clock", title: "Open History", keywords: "recent files last opened", run: openHistory },
    { group: "Editor", icon: "read", title: "Read Mode", key: "Alt R", keywords: "view preview rendered", on: hasDoc, run: () => setMode("read") },
    { group: "Editor", icon: "split", title: "Split Mode", key: "Alt S", keywords: "side by side live preview", on: hasDoc, run: () => setMode("split") },
    { group: "Editor", icon: "edit", title: "Edit Mode", key: "Alt E", keywords: "source write textarea", on: hasDoc, run: () => setMode("edit") },
    { group: "Editor", icon: "refresh", title: "Cycle View Mode", key: "Ctrl E", keywords: "switch rotate toggle view", on: hasDoc, run: () => setMode({ read: "split", split: "edit", edit: "read" }[state.mode]) },
    { group: "Editor", icon: "search", title: "Find", key: "Ctrl F", keywords: "search text locate", on: hasDoc, run: () => openFind() },
    { group: "Editor", icon: "replace", title: "Find & Replace", key: "Ctrl H", keywords: "search substitute swap", on: hasDoc, run: () => openFind(undefined, { replace: true }) },
    { group: "Editor", icon: "edit", title: "Bold", key: "Ctrl B", keywords: "strong format selection", on: editing, run: () => wrapSelection("**") },
    { group: "Editor", icon: "edit", title: "Italic", key: "Ctrl I", keywords: "emphasis format selection", on: editing, run: () => wrapSelection("*") },
    { group: "Editor", icon: "edit", title: "Insert Link", key: "Ctrl K", keywords: "url hyperlink format selection", on: editing, run: () => wrapSelection("[", "](url)", { toggle: false, select: "url" }) },
    { group: "View", icon: "sidebar", title: "Toggle Sidebar", key: "Ctrl B", keywords: "files panel hide show tree outline", run: toggleSidebar },
    { group: "View", icon: "plus", title: "Zoom In", key: "Ctrl +", keywords: "bigger larger font size text", run: () => zoom(1) },
    { group: "View", icon: "min", title: "Zoom Out", key: "Ctrl -", keywords: "smaller font size text", run: () => zoom(-1) },
    { group: "View", icon: "refresh", title: "Reset Zoom", key: "Ctrl 0", keywords: "default font size text", run: () => zoom(0) },
    { group: "Mark", icon: "sparkle", title: "Toggle Mark", key: "Ctrl Shift M", keywords: "ai assistant chat sidebar panel", run: toggleAiPanel },
    { group: "Mark", icon: "plus", title: "New Chat with Mark", keywords: "ai assistant conversation clean", run: () => { openAiPanel(); newAiChat(); } },
    { group: "Mark", icon: "clock", title: "Mark Chat History", keywords: "ai assistant saved chats conversations", run: () => openAiHistory() },
    { group: "Preferences", icon: "settings", title: "Settings", key: "Ctrl ,", keywords: "preferences appearance theme themes dark light accent color font fonts typography typeface size reading width interface document editor", run: openSettings },
    { group: "Help", icon: "info", title: "About Markdown", keywords: "version about info credits app", run: openAbout },
    ...found,
  ];
}

/** Literal substring hits always outrank subsequence hits; both beat no match (-1). */
function fuzzyScore(s, q) {
  if (!q) return 0;
  const lit = s.indexOf(q);
  if (lit !== -1) return 100 - Math.min(lit, 20);
  let score = 0, at = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, at);
    if (i === -1) return -1;
    score += i === at ? 3 : s[i - 1] === " " ? 2 : 1;
    at = i + 1;
  }
  return score;
}

function renderPalette() {
  const q = el.paletteInput.value.trim().toLowerCase();
  paletteMatches = paletteCommands(q)
    .map((c, i) => ({ c, i, s: fuzzyScore(`${c.title} ${c.keywords || ""}`.toLowerCase(), q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  paletteMatches.forEach((x, mi) => (x.mi = mi));
  const groups = PALETTE_GROUPS
    .map((g, gi) => ({ g, gi, rows: paletteMatches.filter((x) => x.c.group === g).slice(0, g === "Headings" || g === "Files" ? PALETTE_DYNAMIC_MAX : undefined) }))
    .filter((x) => x.rows.length);
  // While searching, float the group holding the best match to the top (so Enter runs it);
  // with no query, keep the familiar menu order.
  if (q) groups.sort((a, b) => b.rows[0].s - a.rows[0].s || a.gi - b.gi);
  el.paletteList.innerHTML = groups.map(({ g, rows }) =>
    `<div class="pg-label">${g}</div><div class="pg-box">` + rows.map((x) => {
      const c = x.c;
      return `<button class="palette-row${c.on === false ? " is-disabled" : ""}" data-mi="${x.mi}">
        ${svg(c.icon)}<span class="pr-title">${escapeHtml(c.title)}</span>${c.sub ? `<span class="pr-sub">${escapeHtml(c.sub)}</span>` : ""}${c.key ? `<kbd>${escapeHtml(c.key)}</kbd>` : ""}</button>`;
    }).join("") + "</div>").join("") || `<div class="palette-empty">No matching commands</div>`;
  selectPalette(0);
}

function paletteRows() {
  return $$(".palette-row:not(.is-disabled)", el.paletteList);
}

function selectPalette(i) {
  const rows = paletteRows();
  if (!rows.length) return;
  paletteSel = ((i % rows.length) + rows.length) % rows.length;
  rows.forEach((r, n) => r.classList.toggle("is-active", n === paletteSel));
  rows[paletteSel].scrollIntoView({ block: "nearest" });
}

function runPalette(mi) {
  const x = paletteMatches[mi];
  if (!x || x.c.on === false) return;
  closePalette();
  x.c.run();
}

function openPalette() {
  el.paletteInput.value = "";
  renderPalette();
  el.paletteDlg.showModal();
  el.paletteInput.focus();
}

function closePalette() {
  el.paletteDlg.close();
}

el.paletteInput.addEventListener("input", renderPalette);
el.paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); selectPalette(paletteSel + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); selectPalette(paletteSel - 1); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const row = paletteRows()[paletteSel];
    if (row) runPalette(+row.dataset.mi);
  }
});
el.paletteList.addEventListener("click", (e) => {
  const row = e.target.closest(".palette-row");
  if (row) runPalette(+row.dataset.mi);
});
el.paletteList.addEventListener("mouseover", (e) => {
  const row = e.target.closest(".palette-row:not(.is-disabled)");
  if (row) selectPalette(paletteRows().indexOf(row));
});
el.paletteDlg.addEventListener("click", (e) => {
  if (e.target === el.paletteDlg) closePalette(); // click on the backdrop
});

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape" && el.win.dataset.sidebar === "overlay") el.win.dataset.sidebar = "";
  if (e.key === "Escape" && !el.aiSelChip.hidden) { hideSelChip(); return; }
  if (e.key === "Escape" && !el.aiHistory.hidden) { closeAiHistory(); return; }
  if (e.key === "Escape" && !el.aiMenu.hidden) { closeAiEffortMenu(); return; }
  if (e.key === "Escape" && !el.history.hidden) { closeHistory(); return; }
  if (e.key === "Escape" && !el.findbar.hidden && !e.defaultPrevented) { closeFind(); return; }
  if (e.key === "F3" || (mod && e.key.toLowerCase() === "g")) {
    e.preventDefault();
    if (el.findbar.hidden) openFind(); else gotoMatch(find.index + (e.shiftKey ? -1 : 1));
    return;
  }
  const k = e.key.toLowerCase();
  if (e.altKey && !mod && !e.shiftKey && state.path && !document.querySelector("dialog[open]")) {
    const mode = { r: "read", s: "split", e: "edit" }[k];
    if (mode) { e.preventDefault(); setMode(mode); }
    return;
  }
  if (!mod || e.altKey || document.querySelector("dialog[open]")) return;
  if (e.shiftKey && k === "m") { e.preventDefault(); toggleAiPanel(); return; }
  const run = {
    o: () => (e.shiftKey ? pickFolder() : pickFile()),
    s: () => save().then((ok) => ok && toast("Saved")),
    f: () => (e.shiftKey ? (el.win.dataset.sidebar === "closed" && toggleSidebar(), narrow.matches && (el.win.dataset.sidebar = "overlay"), el.sbSearch.focus(), el.sbSearch.select()) : openFind()),
    h: () => openFind(undefined, { replace: true }),
    p: () => (e.shiftKey ? openPalette() : exportPdf()),
    n: () => (e.shiftKey ? newWindow() : newFile()),
    e: () => state.path && setMode({ read: "split", split: "edit", edit: "read" }[state.mode]),
    b: toggleSidebar,
    ",": actions.settings,
    "=": () => zoom(1),
    "+": () => zoom(1),
    "-": () => zoom(-1),
    "0": () => zoom(0),
  }[k];
  if (run) { e.preventDefault(); run(); }
});

// ---------- Mark (AI) ----------
function nanoid8() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += alphabet[byte & 63];
  return id;
}

function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateLabel(date) {
  const now = new Date();
  const today = localDate(now);
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDuration(ms) {
  if (!ms) return "";
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const fmtCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n || 0));

function formatCost(cost) {
  if (cost == null || !Number.isFinite(cost)) return "";
  if (cost === 0) return "$0";
  const digits = cost < 0.001 ? 8 : cost < 0.01 ? 6 : cost < 1 ? 4 : 2;
  return `$${cost.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function usageParts(usage, { compact = false } = {}) {
  const fmt = compact ? fmtCount : (n) => Number(n || 0).toLocaleString();
  const parts = [`${fmt(usage.input)} in`, `${fmt(usage.output)} out`];
  if (usage.reasoning) parts.push(`${fmt(usage.reasoning)} thinking`);
  if (usage.cost != null) parts.push(formatCost(usage.cost));
  return parts;
}

function recalcChatUsage(chat) {
  const total = { input: 0, output: 0, reasoning: 0, cost: null };
  let seen = false;
  for (const message of chat.messages || []) {
    if (message.role !== "assistant" || !message.usage) continue;
    seen = true;
    total.input += message.usage.input || 0;
    total.output += message.usage.output || 0;
    total.reasoning += message.usage.reasoning || 0;
    if (message.usage.cost != null) total.cost = (total.cost || 0) + message.usage.cost;
  }
  if (seen) chat.usage = total;
  return chat.usage;
}

function currentFileMeta() {
  const name = state.path ? baseName(state.path) : state.untitled ? "Untitled" : null;
  return name ? { path: state.path, name } : null;
}

function selectionDetail(selection) {
  if (!selection) return "";
  const where = selection.lines ? `Lines ${selection.lines[0]}–${selection.lines[1]}` : selection.source === "preview" ? "Selected text" : "Selection";
  return selection.heading ? `${where} · ${selection.heading}` : where;
}

function updateAiChrome() {
  const chat = state.ai.chat;
  el.aiTitle.textContent = chat?.title || "New chat";
  updateAiModelLabel();
  const file = currentFileMeta();
  el.aiChipFile.hidden = !file;
  if (file) {
    $(".ai-chip-text", el.aiChipFile).textContent = file.name;
    el.aiChipFile.dataset.tip = file.path || file.name;
    el.aiChipFile.title = file.path || file.name;
  }
  const selection = state.ai.selection;
  el.aiChipSel.hidden = !selection;
  if (selection) {
    $(".ai-chip-text", el.aiChipSel).textContent = selection.lines ? `Selection · ${selection.lines[0]}–${selection.lines[1]}` : "Selection";
    el.aiChipSel.title = selection.text.slice(0, 600);
  }
  const reply = state.ai.reply;
  el.aiChipReply.hidden = !reply;
  if (reply) {
    $(".ai-chip-text", el.aiChipReply).textContent = `Reply · ${reply.snippet || reply.text.slice(0, 40)}`;
    el.aiChipReply.title = reply.text.slice(0, 600);
  }
  el.aiCtx.hidden = !file && !selection && !reply;
  const usage = chat?.usage;
  if (usage && (usage.input || usage.output)) {
    el.aiChatTotal.textContent = `This chat · ${usageParts(usage, { compact: true }).join(" · ")}`;
    el.aiChatTotal.title = `Input ${usage.input.toLocaleString()} · Output ${usage.output.toLocaleString()}${usage.reasoning ? ` · Reasoning ${usage.reasoning.toLocaleString()}` : ""}${usage.cost != null ? ` · Cost ${formatCost(usage.cost)}` : ""}`;
    el.aiChatTotal.hidden = false;
  } else {
    el.aiChatTotal.hidden = true;
  }
}

function emptySuggestions() {
  return currentFileMeta()
    ? [
        ["Summarize this document", "Summarize this document."],
        ["Explain the structure", "Explain the structure of this document."],
        ["Find TODOs and open questions", "Find TODOs and open questions in this document."],
      ]
    : [
        ["What can you help me with?", "What can you help me with?"],
        ["How do you use a document?", "How do you use the document I have open?"],
        ["Give me a Markdown writing tip", "Give me a quick Markdown writing tip."],
      ];
}

function renderAiEmpty() {
  const file = currentFileMeta();
  const suggestions = emptySuggestions();
  el.aiMessages.innerHTML = `<div class="ai-empty">
    <img src="assets/mark.png" alt="" width="56" height="56" />
    <h2>Ask Mark</h2>
    <p>${file ? `Mark can read <b>${escapeHtml(file.name)}</b> and answer in Markdown.` : "Open a file and Mark will read it with you."}</p>
    <div class="ai-suggestions">${suggestions.map(([label, prompt]) =>
      `<button class="ai-suggest" data-ai-prompt="${escapeHtml(prompt)}">${svg("sparkle")}${escapeHtml(label)}</button>`).join("")}</div>
  </div>`;
}

function ensureChat() {
  if (state.ai.chat) return state.ai.chat;
  const now = new Date().toISOString();
  state.ai.chat = {
    version: 1,
    id: nanoid8(),
    date: localDate(),
    title: "New chat",
    titleEdited: false,
    titleGenerated: false,
    createdAt: now,
    updatedAt: now,
    file: currentFileMeta(),
    provider: aiCurrent()?.provider.id || "",
    model: aiCurrent()?.model.id || "",
    effort: aiEffort(),
    messages: [],
  };
  return state.ai.chat;
}

async function saveAiChat() {
  const chat = state.ai.chat;
  if (!chat || !chat.messages.length) return;
  chat.updatedAt = new Date().toISOString();
  try {
    await invoke("chat_save", { date: chat.date, id: chat.id, json: JSON.stringify(chat) });
  } catch (err) {
    toast(`Couldn't save this chat. ${err}`, "error");
  }
}

function aiDocument() {
  const file = currentFileMeta();
  if (!file) return null;
  return { name: file.name, path: file.path, text: state.text || "", dirty: state.path ? state.text !== state.saved : state.untitled };
}

const aiMemoryOn = () => state.settings.aiMemory !== "off";
const aiDocIsLarge = (doc) => Boolean(doc && doc.text.length > MARK_LIMITS.fullDoc);
const relPath = (path) => (state.folder && path.startsWith(state.folder) ? path.slice(state.folder.length).replace(/^[\\/]/, "") : path);

// Parts are ordered from rarely to often changing; see markctx.js.
function systemPrompt(chat) {
  const files = folderFiles().length;
  return [
    MARK_RULES,
    memoryContext(state.ai.memory, aiMemoryOn()),
    `## Session\nDate: ${localDate()}${files ? `\nOpen folder: ${state.folder} (${files} Markdown files)` : ""}`,
    documentContext(aiDocument(), scanSource),
    chat.summary ? `## Earlier in this conversation (summary)\n${chat.summary}` : "",
  ].filter(Boolean).join("\n\n");
}

function aiTools() {
  return markTools({ largeDoc: aiDocIsLarge(aiDocument()), hasFolder: folderFiles().length > 0, memory: aiMemoryOn() });
}

function apiUserContent(message) {
  const parts = [];
  if (message.reply?.text) {
    const who = message.reply.role === "assistant" ? "Mark's" : "the user's";
    parts.push(`[Replying to this part of ${who} previous message]\n${message.reply.text}`);
  }
  if (message.selection?.text) {
    const where = message.selection.lines ? `lines ${message.selection.lines[0]}–${message.selection.lines[1]}` : message.selection.heading || "the selection";
    parts.push(`[Selected text — ${where}]\n${message.selection.text}`);
  }
  return parts.length ? `${parts.join("\n\n")}\n\n${message.content}` : message.content;
}

function buildApiMessages(chat) {
  // Past turns go as plain text: tool results are not replayed, and summarised turns are skipped.
  const history = chat.messages.slice(chat.summarizedCount || 0).filter((message) => !(message.role === "assistant" && !message.content));
  return [
    { role: "system", content: systemPrompt(chat) },
    ...history.map((message) => ({
      role: message.role,
      content: message.role === "user" ? apiUserContent(message) : message.content,
    })),
  ];
}

function seedActions(chat, effort) {
  const doc = aiDocument();
  const actions = [!doc
    ? { kind: "context", id: "context", label: "No document open", detail: "Answering without file context", status: "done" }
    : aiDocIsLarge(doc)
      ? { kind: "context", id: "context", label: `Outlined ${doc.name}`, detail: `${fmtCount(doc.text.length)} characters · reads parts on demand`, status: "done" }
      : { kind: "context", id: "context", label: `Read ${doc.name}`, detail: `${fmtCount(doc.text.length)} characters`, status: "done" }];
  const memory = state.ai.memory;
  const remembered = aiMemoryOn() ? memory.items.length : 0;
  if (remembered || memory.profile.trim()) {
    const detail = [memory.profile.trim() && "your notes", remembered && `${remembered} ${remembered === 1 ? "memory" : "memories"}`].filter(Boolean).join(" · ");
    actions.push({ kind: "context", id: "memory", label: "Personalized", detail, status: "done" });
  }
  const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
  if (lastUser?.selection?.text) {
    actions.push({ kind: "selection", id: "selection", label: "Selection attached", detail: selectionDetail(lastUser.selection), status: "done" });
  }
  actions.push({ kind: "model", id: "model", label: aiModelName(aiCurrent()), detail: effort ? `effort ${aiEffortName(effort).toLowerCase()}` : aiCurrent()?.provider.name || "", status: "running" });
  return actions;
}

function setAiPhase(node, text) {
  const phase = $(".ai-phase", node);
  if (!phase) return;
  phase.hidden = !text;
  if (text) phase.textContent = text;
}

function updateThinking(node, msg, streaming) {
  const details = $(".ai-think", node);
  const body = $(".ai-reasoning", node);
  const label = $(".ai-think-label", node);
  const text = msg.reasoning || "";
  if (!text) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  if (body.textContent !== text) {
    const pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    body.textContent = text;
    if (streaming && pinned) body.scrollTop = body.scrollHeight;
  }
  details.classList.toggle("streaming", Boolean(streaming));
  if (streaming) {
    label.textContent = "Thinking…";
  } else {
    const duration = msg.reasoningDurationMs || msg.timing?.durationMs || 0;
    label.textContent = duration ? `Thought for ${fmtDuration(duration)}` : "Show reasoning";
  }
}

function updateTrace(node, msg) {
  const details = $(".ai-trace", node);
  const list = $(".ai-trace-list", node);
  const actions = msg.actions || [];
  details.hidden = !actions.length;
  if (!actions.length) return;
  $(".ai-trace-count", node).textContent = String(actions.length);
  details.classList.toggle("streaming", Boolean(state.ai.streaming && state.ai.current?.msg === msg));
  list.innerHTML = actions.map((action) => {
    const icon = action.kind === "context" ? "file" : action.kind === "selection" ? "sparkle" : action.kind === "model" ? "sparkle" : "activity";
    const stateIcon = action.status === "error" ? "alert" : action.status === "running" ? "loader" : "check";
    const label = action.label || action.name || "Action";
    const detail = action.detail || "";
    return `<li class="ai-trace-item" data-status="${escapeHtml(action.status || "done")}">
      <span class="ai-trace-ico">${svg(icon)}</span>
      <span class="ai-trace-text"><span class="ai-trace-label">${escapeHtml(label)}</span><span class="ai-trace-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span></span>
      <span class="ai-trace-state">${svg(stateIcon)}</span>
    </li>`;
  }).join("");
}

function updateAiMeta(node, msg) {
  const meta = $(".ai-meta", node);
  const parts = [];
  if (msg.timing?.durationMs) parts.push(fmtDuration(msg.timing.durationMs));
  if (msg.usage) parts.push(...usageParts(msg.usage));
  if (msg.effort) parts.push(aiEffortName(msg.effort).toLowerCase());
  meta.textContent = parts.join(" · ");
  meta.title = msg.usage
    ? `Input ${Number(msg.usage.input || 0).toLocaleString()} · Output ${Number(msg.usage.output || 0).toLocaleString()}${msg.usage.reasoning ? ` · Reasoning ${Number(msg.usage.reasoning).toLocaleString()}` : ""}${msg.usage.cost != null ? ` · Cost ${formatCost(msg.usage.cost)}` : ""}`
    : "";
  if (msg.stopped) {
    const tag = document.createElement("span");
    tag.className = "ai-stopped";
    tag.textContent = "Stopped";
    meta.prepend(tag);
  }
}

async function renderChatMarkdown(node, src, { streaming = false } = {}) {
  const body = $(".chat-md", node);
  if (!body) return;
  const token = String(Number(body.dataset.renderToken || 0) + 1);
  body.dataset.renderToken = token;
  if (!src) {
    body.innerHTML = streaming ? `<span class="ai-caret" aria-hidden="true"></span>` : "";
    return;
  }
  try {
    const html = await invoke("render_markdown", { src });
    if (!node.isConnected || body.dataset.renderToken !== token) return;
    body.innerHTML = html;
    for (const child of body.querySelectorAll("[id]")) child.removeAttribute("id");
    for (const link of body.querySelectorAll("a[href]")) {
      if (/^(https?:|mailto:)/i.test(link.getAttribute("href"))) link.classList.add("external");
      else link.removeAttribute("href");
    }
    decorateRich(body);
    if (streaming) body.insertAdjacentHTML("beforeend", `<span class="ai-caret" aria-hidden="true"></span>`);
  } catch {
    if (body.dataset.renderToken === token) body.textContent = src;
  }
}

function scheduleChatRender(node, msg) {
  if (state.ai.renderTimer) return;
  state.ai.renderTimer = setTimeout(() => {
    state.ai.renderTimer = null;
    renderChatMarkdown(node, msg.content || "", { streaming: true });
  }, 120);
}

function renderAiMessage(msg, index) {
  const node = document.createElement("article");
  node.dataset.i = String(index);

  if (msg.role === "user") {
    node.className = "ai-msg ai-msg-user";
    if (msg.reply?.text) {
      const quote = document.createElement("div");
      quote.className = "ai-sel-quote ai-reply-quote";
      quote.title = msg.reply.text;
      const label = document.createElement("b");
      label.textContent = msg.reply.role === "assistant" ? "Replying to Mark" : "Replying to your message";
      quote.append(label, document.createTextNode(`${msg.reply.text.slice(0, 600)}${msg.reply.text.length > 600 ? "…" : ""}`));
      node.append(quote);
    }
    if (msg.selection?.text) {
      const quote = document.createElement("div");
      quote.className = "ai-sel-quote";
      quote.title = msg.selection.text;
      const label = document.createElement("b");
      label.textContent = selectionDetail(msg.selection);
      quote.append(label, document.createTextNode(`${msg.selection.text.slice(0, 600)}${msg.selection.text.length > 600 ? "…" : ""}`));
      node.append(quote);
    }
    const bubble = document.createElement("div");
    bubble.className = "ai-bubble";
    bubble.textContent = msg.content;
    node.append(bubble);
    return node;
  }

  node.className = "ai-msg ai-msg-assistant";
  node.innerHTML = `<header class="ai-msg-head">
      <img class="ai-avatar-sm" src="assets/mark.png" alt="" width="20" height="20" />
      <span class="ai-name">Mark</span>
      <span class="ai-tag">${escapeHtml(msg.modelName || "DeepSeek V4.1 Flash")}</span>
      <span class="ai-tag ai-tag-effort"></span>
      <time class="ai-time"></time>
    </header>
    <div class="ai-phase" role="status" hidden></div>
    <details class="ai-think" hidden>
      <summary><svg class="chev"><use href="#i-chevron"/></svg><svg class="ico"><use href="#i-sparkle"/></svg><span class="ai-think-label">Thinking…</span><span class="ai-think-time"></span></summary>
      <div class="ai-reasoning"></div>
    </details>
    <details class="ai-trace" hidden>
      <summary><svg class="chev"><use href="#i-chevron"/></svg><svg class="ico"><use href="#i-activity"/></svg><span>Actions</span><span class="ai-trace-count"></span></summary>
      <ol class="ai-trace-list"></ol>
    </details>
    <div class="md chat-md"></div>
    <footer class="ai-actions"><button class="ai-act" data-ai-copy>Copy</button><span class="ai-meta"></span></footer>`;

  $(".ai-tag-effort", node).textContent = aiEffortName(msg.effort);
  $(".ai-tag-effort", node).hidden = !msg.effort;
  const created = msg.createdAt ? new Date(msg.createdAt) : null;
  $(".ai-time", node).textContent = created && !Number.isNaN(created.getTime()) ? created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  for (const action of msg.actions || []) if (action.status === "running") action.status = "done";
  updateThinking(node, msg, false);
  updateTrace(node, msg);
  updateAiMeta(node, msg);
  $("summary", $(".ai-think", node)).addEventListener("click", () => {
    $(".ai-think", node).dataset.userToggled = "1";
  });
  return node;
}

function appendAiMessage(msg, index) {
  $(".ai-empty", el.aiMessages)?.remove();
  const node = renderAiMessage(msg, index);
  el.aiMessages.append(node);
  return node;
}

async function renderAiMessages() {
  const chat = state.ai.chat;
  el.aiMessages.innerHTML = "";
  if (!chat || !chat.messages.length) {
    renderAiEmpty();
    updateAiChrome();
    return;
  }
  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i];
    const node = renderAiMessage(message, i);
    el.aiMessages.append(node);
    if (message.role === "assistant" && message.content) await renderChatMarkdown(node, message.content);
  }
  updateAiChrome();
  state.ai.pinned = true;
  scrollAiIfPinned(true);
}

function scrollAiIfPinned(force = false) {
  if (force || state.ai.pinned) el.aiMessages.scrollTop = el.aiMessages.scrollHeight;
}

function showAiError(message, { retry = true } = {}) {
  const box = document.createElement("div");
  box.className = "ai-error";
  box.innerHTML = `<span class="ai-error-ico">${svg("alert")}</span><div class="ai-error-text"></div>
    <div class="ai-error-acts"><button class="btn btn-ghost" data-ai-action="settings">Settings</button>${retry ? `<button class="btn btn-ghost" data-ai-action="retry">Retry</button>` : ""}</div>`;
  $(".ai-error-text", box).textContent = message;
  el.aiMessages.append(box);
  scrollAiIfPinned(true);
}

function handleAiEvent(event) {
  const current = state.ai.current;
  if (!current) return;
  const { msg, node } = current;

  if (event.type === "status") {
    setAiPhase(node, event.phase === "thinking" ? "Thinking…" : event.phase === "writing" ? "Writing…" : "Reading document…");
    if (event.phase === "thinking") {
      const details = $(".ai-think", node);
      if (!details.hidden && !details.dataset.userToggled) details.open = true;
    }
    return;
  }

  if (event.type === "reasoning_delta") {
    if (!current.reasoningStart) current.reasoningStart = performance.now();
    msg.reasoning = `${msg.reasoning || ""}${event.text || ""}`.slice(0, AI_MAX_REASONING);
    updateThinking(node, msg, true);
    const details = $(".ai-think", node);
    if (!details.dataset.userToggled) details.open = true;
    setAiPhase(node, "Thinking…");
    scrollAiIfPinned();
    return;
  }

  if (event.type === "delta") {
    if (!current.contentStarted) {
      current.contentStarted = true;
      if (current.reasoningStart) msg.reasoningDurationMs = Math.round(performance.now() - current.reasoningStart);
      updateThinking(node, msg, false);
      const details = $(".ai-think", node);
      if (details.open && !details.dataset.userToggled) details.open = false;
      node.classList.add("streaming");
    }
    setAiPhase(node, "Writing…");
    msg.content = `${msg.content || ""}${event.text || ""}`;
    scheduleChatRender(node, msg);
    scrollAiIfPinned();
    return;
  }

  if (event.type === "action") {
    aiToolAction(current, event.id, event.name);
    updateTrace(node, msg);
    scrollAiIfPinned();
    return;
  }

  if (event.type === "done") {
    // Usage and timing are summed over the answer's rounds in runAssistantTurn.
    if (!current.contentStarted && current.reasoningStart) msg.reasoningDurationMs = Math.round(performance.now() - current.reasoningStart);
  }
}

function setAiStreaming(streaming) {
  el.aiSend.hidden = streaming;
  el.aiStop.hidden = !streaming;
  el.aiSend.disabled = streaming;
}

async function sendAiMessage(text) {
  const value = String(text || "").trim();
  if (!value) return;
  if (state.ai.streaming) {
    toast("Stop Mark first.", "error");
    return;
  }
  if (!aiCurrent()) {
    toast("Choose a model first: Settings → Mark → Add model provider.", "error");
    return;
  }
  if (!state.ai.open) openAiPanel({ focus: false });
  const chat = ensureChat();
  const selection = state.ai.selection;
  const reply = state.ai.reply;
  chat.file = currentFileMeta();
  chat.effort = aiEffort();
  chat.messages.push({ role: "user", content: value, selection: selection || null, reply: reply || null, createdAt: new Date().toISOString() });
  state.ai.selection = null;
  state.ai.reply = null;
  state.ai.pinned = true;
  el.aiInput.value = "";
  aiAutoGrow();
  updateAiChrome();
  for (const box of $$(".ai-error", el.aiMessages)) box.remove();
  appendAiMessage(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
  scrollAiIfPinned(true);
  await saveAiChat();
  requestAssistant();
}

async function requestAssistant() {
  const chat = state.ai.chat;
  if (!chat || !chat.messages.length || state.ai.streaming) return;
  const target = aiCurrent();
  if (!target) {
    toast("Choose a model first: Settings → Mark → Add model provider.", "error");
    return;
  }
  chat.provider = target.provider.id;
  chat.model = target.model.id;
  const effort = (chat.effort = aiEffort(target));
  chat.file = currentFileMeta();
  const assistant = {
    role: "assistant",
    content: "",
    reasoning: "",
    reasoningDurationMs: 0,
    actions: seedActions(chat, effort),
    usage: null,
    timing: null,
    stopped: false,
    effort,
    modelName: aiModelName(target),
    createdAt: new Date().toISOString(),
  };
  chat.messages.push(assistant);
  const index = chat.messages.length - 1;
  const node = appendAiMessage(assistant, index);
  node.classList.add("streaming");
  const think = $(".ai-think", node);
  if (think) delete think.dataset.userToggled;
  state.ai.current = { msg: assistant, node, index, reasoningStart: 0, contentStarted: false };
  state.ai.streaming = true;
  setAiPhase(node, "Reading document…");
  setAiStreaming(true);
  scrollAiIfPinned(true);

  const channel = new Channel();
  channel.onmessage = handleAiEvent;
  try {
    await finalizeAssistant(await runAssistantTurn(chat, effort, channel));
  } catch (err) {
    failAssistant(String(err));
  } finally {
    state.ai.streaming = false;
    state.ai.requestId = null;
    setAiStreaming(false);
    state.ai.current?.node.classList.remove("streaming");
  }
}

/** The trace entry for one tool call; ids are scoped by round because fallback ids repeat. */
function aiToolAction(current, id, name) {
  const key = `${current.round || 1}:${id || name}`;
  let action = current.msg.actions.find((item) => item.id === key);
  if (!action) {
    action = { kind: "tool", id: key, label: AI_TOOL_LABELS[name] || name || "Tool", detail: "", status: "running" };
    current.msg.actions.push(action);
  }
  return action;
}

/** Folds old turns into `chat.summary` once the history outgrows its budget. */
async function compactAiHistory(chat, current) {
  const sent = chat.messages.slice(0, -1); // without the pending reply
  const from = Math.min(chat.summarizedCount || 0, sent.length);
  const start = historyStart(sent, from);
  if (start <= from) return;
  setAiPhase(current.node, "Summarizing earlier messages…");
  const transcript = sent.slice(from, start).filter((message) => message.content)
    .map((message) => `${message.role === "user" ? "User" : "Mark"}: ${message.content.slice(0, 3000)}`).join("\n\n");
  const action = { kind: "context", id: "summary", label: "Summarized earlier messages", detail: `${start - from} messages`, status: "done" };
  try {
    chat.summary = await invoke("ai_complete", {
      provider: chat.provider,
      model: chat.model,
      maxTokens: 800,
      messages: [
        { role: "system", content: "You compress a conversation between a user and Mark, a Markdown document assistant, so it can continue without the original messages. Keep what the user is trying to do, decisions and conclusions reached, facts and names later turns may rely on, and any open question. Drop pleasantries and exact wording. Write terse bullet points, at most 250 words." },
        { role: "user", content: `${chat.summary ? `Summary so far:\n${chat.summary}\n\n` : ""}Messages to fold in:\n${transcript}\n\nUpdated summary:` },
      ],
    });
  } catch {
    action.label = "Dropped earlier messages"; // the request must still fit; the old summary, if any, stays
  }
  chat.summarizedCount = start;
  current.msg.actions.splice(-1, 0, action); // before the model entry
  updateTrace(current.node, current.msg);
}

/** One answer: model rounds with tool calls in between. Tool results live only inside this turn. */
async function runAssistantTurn(chat, effort, channel) {
  const current = state.ai.current;
  await compactAiHistory(chat, current);
  const messages = buildApiMessages(chat);
  const tools = aiTools();
  const started = performance.now();
  const usage = { input: 0, output: 0, reasoning: 0, cost: null };
  const content = [];
  const reasoning = [];
  let firstTokenMs = 0;
  for (let round = 1; ; round++) {
    current.round = round;
    state.ai.requestId = (crypto.randomUUID && crypto.randomUUID()) || `${nanoid8()}${nanoid8()}`;
    const reply = await invoke("ai_chat", {
      requestId: state.ai.requestId,
      provider: chat.provider,
      model: chat.model,
      effort,
      messages,
      tools,
      toolChoice: round < MARK_LIMITS.toolRounds ? "auto" : "none", // the last round has to answer
      onEvent: channel,
    });
    usage.input += reply.usage?.input || 0;
    usage.output += reply.usage?.output || 0;
    usage.reasoning += reply.usage?.reasoning || 0;
    if (reply.usage?.cost != null) usage.cost = (usage.cost || 0) + reply.usage.cost;
    firstTokenMs ||= reply.timing?.firstTokenMs || 0;
    if (reply.content) content.push(reply.content);
    if (reply.reasoning) reasoning.push(reply.reasoning);
    const calls = reply.stopped ? [] : reply.toolCalls || [];
    if (!calls.length) {
      return {
        content: content.join("\n\n"),
        reasoning: reasoning.join("\n\n").slice(0, AI_MAX_REASONING),
        stopped: reply.stopped,
        usage,
        timing: { firstTokenMs, durationMs: Math.round(performance.now() - started) },
      };
    }
    messages.push({
      role: "assistant",
      content: reply.content || "",
      ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
      ...(reply.providerBlocks ? { provider_blocks: reply.providerBlocks } : {}), // handed back unchanged; see anthropic.rs
      tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
    });
    for (const call of calls) messages.push({ role: "tool", tool_call_id: call.id, content: await runAiToolCall(current, call) });
    // Later rounds stream onto the same message; keep what is shown equal to what will be saved.
    current.msg.content = content.length ? `${content.join("\n\n")}\n\n` : "";
    current.msg.reasoning = reasoning.length ? `${reasoning.join("\n\n")}\n\n` : "";
    setAiPhase(current.node, "Thinking…");
  }
}

async function runAiToolCall(current, call) {
  const action = aiToolAction(current, call.id, call.name);
  let result;
  try {
    let args = {};
    try { args = JSON.parse(call.arguments || "{}") || {}; } catch { throw new Error("The arguments were not valid JSON."); }
    const out = await runAiTool(call.name, args);
    result = out.result;
    action.detail = out.detail;
    action.status = "done";
  } catch (err) {
    result = `Error: ${err?.message || err}`;
    action.detail = String(err?.message || err);
    action.status = "error";
  }
  updateTrace(current.node, current.msg);
  scrollAiIfPinned();
  return result;
}

/** Runs one tool for the model. Files are limited to the Markdown files of the open folder. */
async function runAiTool(name, args) {
  const text = state.text || "";
  const query = String(args.query || "").trim();
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;
  switch (name) {
    case "read_document": {
      if (!currentFileMeta()) throw new Error("No document is open.");
      const out = numberedLines(text, args.start_line, args.end_line);
      return { result: out.text, detail: `Lines ${out.from}–${out.to}` };
    }
    case "search_document": {
      if (!query) throw new Error("query is empty.");
      const { hits, total } = searchLines(text, query);
      const head = `${count(total, "matching line")}${total > hits.length ? ` (first ${hits.length} shown)` : ""}:`;
      return { result: total ? `${head}\n${hits.map((hit) => `${hit.line}: ${hit.text}`).join("\n")}` : "No matches.", detail: `“${query}” · ${count(total, "match")}` };
    }
    case "list_files": {
      const files = folderFiles().map(relPath);
      const shown = files.slice(0, 400);
      return { result: `${shown.join("\n") || "The open folder has no Markdown files."}${files.length > shown.length ? `\n[${files.length - shown.length} more not listed; use search_files.]` : ""}`, detail: count(files.length, "file") };
    }
    case "search_files": {
      if (!query) throw new Error("query is empty.");
      const hits = await invoke("search_files", { paths: folderFiles(), query });
      const shown = hits.slice(0, 60);
      return { result: shown.length ? shown.map((hit) => `${relPath(hit.path)}:${hit.line}: ${hit.text}`).join("\n") : "No matches.", detail: `“${query}” · ${count(hits.length, "match")}` };
    }
    case "read_file": {
      const want = String(args.path || "").trim().replace(/^\.[\\/]/, "");
      const path = folderFiles().find((file) => file === want || relPath(file) === want);
      if (!path) throw new Error("No such Markdown file in the open folder. Call list_files for valid paths.");
      const out = numberedLines(path === state.path ? text : await invoke("read_file", { path }), args.start_line, args.end_line);
      return { result: `${relPath(path)}\n${out.text}`, detail: `${relPath(path)} · lines ${out.from}–${out.to}` };
    }
    case "remember": {
      if (!aiMemoryOn()) throw new Error("Memory is turned off.");
      const item = await changeAiMemory((memory) => rememberFact(memory, args.text));
      if (!item) throw new Error("text is empty.");
      toast(`Mark will remember: ${item.text}`);
      return { result: `Saved as [${item.id}].`, detail: item.text };
    }
    case "forget": {
      if (!aiMemoryOn()) throw new Error("Memory is turned off.");
      const gone = await changeAiMemory((memory) => {
        const at = memory.items.findIndex((item) => item.id === String(args.id || "").replace(/[[\]]/g, ""));
        return at === -1 ? null : memory.items.splice(at, 1)[0];
      });
      if (!gone) throw new Error("No memory has that id.");
      return { result: "Deleted.", detail: gone.text };
    }
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

async function loadAiMemory() {
  try {
    state.ai.memory = normalizeMemory(JSON.parse(await invoke("memory_load")));
  } catch { /* keep what is in memory */ }
}

/** Reload (another window may have written), change, write back. Returns what `change` returns. */
async function changeAiMemory(change) {
  await loadAiMemory();
  const out = change(state.ai.memory);
  try {
    await invoke("memory_save", { json: JSON.stringify({ version: 1, ...state.ai.memory }) });
  } catch (err) {
    toast(`Couldn't save Mark's memory. ${err}`, "error");
    throw err;
  }
  renderAiMemory();
  return out;
}

function renderAiMemory() {
  const items = state.ai.memory.items;
  el.aiMemoryList.innerHTML = items.length
    ? items.map((item) => `<li><span>${escapeHtml(item.text)}</span><button class="icon-btn sm" data-action="ai-forget" data-id="${escapeHtml(item.id)}" data-tip="Forget" aria-label="Forget this memory">${svg("trash")}</button></li>`).join("")
    : `<li class="ai-memory-empty">Nothing saved yet. Tell Mark about yourself or how you like answers, and it will remember.</li>`;
}

el.aiProfile.addEventListener("input", debounce(() => {
  const profile = el.aiProfile.value.slice(0, MARK_LIMITS.profile);
  changeAiMemory((memory) => { memory.profile = profile; }).catch(() => {});
}, 500));

async function finalizeAssistant(reply) {
  const current = state.ai.current;
  if (!current) return;
  const { msg, node } = current;
  if (reply?.content) msg.content = reply.content;
  if (reply?.reasoning) msg.reasoning = reply.reasoning;
  if (reply?.usage) msg.usage = reply.usage;
  if (reply?.timing) msg.timing = reply.timing;
  msg.stopped = Boolean(reply?.stopped);
  if (reply?.actions?.length) {
    for (const action of reply.actions) {
      const existing = (msg.actions || []).find((item) => item.id === action.id);
      if (existing) Object.assign(existing, action);
      else msg.actions.push({ kind: "tool", ...action });
    }
  }
  for (const action of msg.actions || []) if (action.status === "running") action.status = "done";
  if (!current.contentStarted && current.reasoningStart && !msg.reasoningDurationMs) {
    msg.reasoningDurationMs = Math.round(performance.now() - current.reasoningStart);
  }
  if (state.ai.renderTimer) {
    clearTimeout(state.ai.renderTimer);
    state.ai.renderTimer = null;
  }
  setAiPhase(node, "");
  node.classList.remove("streaming");
  updateThinking(node, msg, false);
  updateTrace(node, msg);
  await renderChatMarkdown(node, msg.content || "");
  updateAiMeta(node, msg);
  state.ai.current = null;
  scrollAiIfPinned();
  if (state.ai.chat) recalcChatUsage(state.ai.chat);
  updateAiChrome();
  await saveAiChat();
  maybeGenerateTitle();
}

function failAssistant(message) {
  const current = state.ai.current;
  const chat = state.ai.chat;
  if (current) {
    if (chat?.messages[chat.messages.length - 1] === current.msg) chat.messages.pop();
    current.node.remove();
    state.ai.current = null;
  }
  if (state.ai.renderTimer) {
    clearTimeout(state.ai.renderTimer);
    state.ai.renderTimer = null;
  }
  showAiError(message, { retry: true });
  saveAiChat();
  updateAiChrome();
}

async function stopAi() {
  if (!state.ai.streaming || !state.ai.requestId) return;
  try {
    await invoke("ai_cancel", { requestId: state.ai.requestId });
  } catch { /* the stream will finish on its own */ }
}

function aiAutoGrow() {
  el.aiInput.style.height = "auto";
  el.aiInput.style.height = `${Math.min(el.aiInput.scrollHeight, 160)}px`;
}

function cleanTitle(value) {
  return String(value || "")
    .split("\n")[0]
    .replace(/^[\s"'`*#>-]+/, "")
    .replace(/[\s"'`*#]+$/, "")
    .trim()
    .slice(0, 60);
}

const fallbackTitle = (text) => cleanTitle(String(text || "").replace(/\s+/g, " ")) || "New chat";

async function maybeGenerateTitle() {
  const chat = state.ai.chat;
  if (!chat || chat.titleEdited || chat.titleGenerated || state.ai.titleBusy) return;
  const firstUser = chat.messages.find((message) => message.role === "user");
  const firstAssistant = chat.messages.find((message) => message.role === "assistant" && message.content);
  if (!firstUser || !firstAssistant) return;
  const fallback = fallbackTitle(firstUser.content);
  const isDefault = !chat.title || chat.title === "New chat" || chat.title === fallback;
  if (!isDefault) return;
  state.ai.titleBusy = true;
  try {
    const title = await invoke("ai_complete", {
      provider: chat.provider,
      model: chat.model,
      maxTokens: 100,
      messages: [
        { role: "system", content: "You name chat conversations. Reply with a short title of 2 to 5 words. No quotes, no markdown, no punctuation at the end." },
        { role: "user", content: `Document: ${chat.file?.name || "none"}\nQuestion: ${firstUser.content.slice(0, 2000)}\nAnswer: ${firstAssistant.content.slice(0, 2000)}\n\nTitle:` },
      ],
    });
    if (state.ai.chat !== chat) return;
    chat.title = cleanTitle(title) || fallback;
    chat.titleGenerated = true;
  } catch {
    if (state.ai.chat !== chat) return;
    chat.title = fallback;
  } finally {
    state.ai.titleBusy = false;
  }
  chat.updatedAt = new Date().toISOString();
  updateAiChrome();
  await saveAiChat();
  loadAiChats();
}

function startAiRename() {
  const chat = state.ai.chat;
  if (!chat) return;
  el.aiTitle.hidden = true;
  el.aiTitleInput.hidden = false;
  el.aiTitleInput.value = chat.title === "New chat" ? "" : chat.title;
  el.aiTitleInput.focus();
  el.aiTitleInput.select();
}

async function finishAiRename(save) {
  if (el.aiTitleInput.hidden) return;
  const chat = state.ai.chat;
  const value = cleanTitle(el.aiTitleInput.value);
  el.aiTitleInput.hidden = true;
  el.aiTitle.hidden = false;
  if (chat && save && value && value !== chat.title) {
    chat.title = value;
    chat.titleEdited = true;
    updateAiChrome();
    await saveAiChat();
    loadAiChats();
  } else {
    updateAiChrome();
  }
  el.aiTitle.focus();
}

async function loadAiChats() {
  try {
    state.ai.list = await invoke("chats_list");
  } catch {
    state.ai.list = [];
  }
  renderAiHistory();
}

function renderAiHistory() {
  const list = state.ai.list;
  if (!list.length) {
    el.aiHistoryList.innerHTML = `<div class="ai-hist-empty">No saved chats yet.<br>Your conversations will appear here.</div>`;
    return;
  }
  const groups = new Map();
  for (const chat of list) {
    if (!groups.has(chat.date)) groups.set(chat.date, []);
    groups.get(chat.date).push(chat);
  }
  el.aiHistoryList.innerHTML = [...groups.entries()].map(([date, chats]) =>
    `<div class="ai-hist-group">${escapeHtml(dateLabel(date))}</div>` + chats.map((chat) => {
      const usage = [];
      if (chat.tokens) usage.push(`${fmtCount(chat.tokens)} tokens`);
      if (chat.cost != null) usage.push(formatCost(chat.cost));
      const usageLabel = usage.length ? ` · ${usage.join(" · ")}` : "";
      return `
      <div class="ai-hist-row" role="listitem" tabindex="0" data-chat-id="${escapeHtml(chat.id)}" data-chat-date="${escapeHtml(chat.date)}" ${state.ai.chat?.id === chat.id ? 'aria-current="true"' : ""} title="${escapeHtml(chat.title)}">
        <span class="ai-hist-text"><span class="ai-hist-title">${escapeHtml(chat.title || "New chat")}</span><span class="ai-hist-sub">${escapeHtml(chat.fileName || "No file")} · ${chat.messageCount} ${chat.messageCount === 1 ? "message" : "messages"}${escapeHtml(usageLabel)}</span></span>
        <span class="ai-hist-acts">
          <button class="icon-btn sm" data-ai-rename-chat="${escapeHtml(chat.id)}" data-chat-date="${escapeHtml(chat.date)}" data-tip="Rename" aria-label="Rename chat">${svg("pencil")}</button>
          <button class="icon-btn sm" data-ai-delete-chat="${escapeHtml(chat.id)}" data-chat-date="${escapeHtml(chat.date)}" data-tip="Delete" aria-label="Delete chat">${svg("trash")}</button>
        </span>
      </div>`;
    }).join("")).join("");
}

async function openAiChat(id, date) {
  if (state.ai.streaming) {
    toast("Stop Mark first.", "error");
    return false;
  }
  try {
    const raw = await invoke("chat_load", { date, id });
    state.ai.chat = JSON.parse(raw);
    recalcChatUsage(state.ai.chat);
    state.ai.selection = null;
    state.ai.reply = null;
    state.ai.current = null;
    el.aiHistory.hidden = true;
    if (!state.ai.open) openAiPanel({ focus: false });
    updateAiChrome();
    await renderAiMessages();
    renderAiHistory();
    el.aiInput.focus();
    maybeGenerateTitle();
    return true;
  } catch (err) {
    toast(`Couldn't open that chat. ${err}`, "error");
    return false;
  }
}

function askDeleteAiChat(id, date) {
  const chat = state.ai.list.find((item) => item.id === id && item.date === date);
  state.ai.deleteTarget = { id, date };
  el.aiDelName.textContent = chat?.title || "this chat";
  el.aiDelDlg.returnValue = "cancel";
  el.aiDelDlg.showModal();
  $('[value="delete"]', el.aiDelDlg).focus();
}

for (const button of $$("button[value]", el.aiDelDlg)) button.onclick = () => el.aiDelDlg.close(button.value);
el.aiDelDlg.addEventListener("close", async () => {
  if (el.aiDelDlg.returnValue !== "delete" || !state.ai.deleteTarget) return;
  const { id, date } = state.ai.deleteTarget;
  state.ai.deleteTarget = null;
  try {
    await invoke("chat_delete", { date, id });
  } catch (err) {
    toast(`Couldn't delete that chat. ${err}`, "error");
    return;
  }
  if (state.ai.chat?.id === id) {
    state.ai.chat = null;
    state.ai.selection = null;
    state.ai.reply = null;
    updateAiChrome();
    renderAiEmpty();
  }
  await loadAiChats();
  toast("Chat deleted.");
});

function newAiChat() {
  if (state.ai.streaming) {
    toast("Stop Mark first.", "error");
    return;
  }
  hideSelChip();
  if (state.ai.chat && !state.ai.chat.messages.length) {
    el.aiInput.focus();
    return;
  }
  state.ai.chat = null;
  state.ai.selection = null;
  state.ai.reply = null;
  state.ai.current = null;
  el.aiHistory.hidden = true;
  el.aiInput.value = "";
  aiAutoGrow();
  updateAiChrome();
  renderAiEmpty();
  el.aiInput.focus();
}

function openAiHistory() {
  if (!state.ai.open) openAiPanel({ focus: false });
  hideSelChip();
  el.aiHistory.hidden = false;
  loadAiChats();
  el.aiHistoryList.querySelector(".ai-hist-row")?.focus();
}

function closeAiHistory() {
  el.aiHistory.hidden = true;
  el.aiInput.focus();
}

function openAiPanel({ focus = true } = {}) {
  if (narrow.matches) el.win.dataset.sidebar = "";
  state.ai.open = true;
  el.aiPanel.hidden = false;
  el.aiSplitter.hidden = false;
  store.set("aiOpen", true);
  updateAiToggle();
  if (!state.ai.chat) renderAiEmpty();
  updateAiChrome();
  if (focus) el.aiInput.focus();
}

function closeAiPanel() {
  state.ai.open = false;
  hideSelChip();
  el.aiPanel.hidden = true;
  el.aiSplitter.hidden = true;
  store.set("aiOpen", false);
  updateAiToggle();
}

function toggleAiPanel() {
  if (state.ai.open) closeAiPanel();
  else openAiPanel();
}

function updateAiToggle() {
  for (const button of $$('[data-action="toggle-ai"]')) button.setAttribute("aria-pressed", String(state.ai.open));
  el.win.dataset.ai = state.ai.open ? "open" : "closed";
}

// ---------- Mark: model providers ----------
const aiProviderById = (id) => state.ai.providers.find((provider) => provider.id === id);
const aiUsable = (provider) => (provider.hasKey || provider.noKey) && provider.models.length > 0;
const aiModelName = (target) => (target ? target.model.name || target.model.id : "Select model");

/** The provider + model in use: the open chat's own, else the default for new chats. */
function aiCurrent() {
  const chat = state.ai.chat;
  // Chats from before providers existed all used the Command Code gateway.
  const picks = [[chat?.provider || (chat?.model ? "commandcode" : ""), chat?.model], [state.settings.aiProvider, state.settings.aiModel]];
  for (const [providerId, modelId] of picks) {
    const provider = aiProviderById(providerId);
    const model = provider?.models.find((item) => item.id === modelId);
    if (model && aiUsable(provider)) return { provider, model };
  }
  return null;
}

function aiEfforts(target) {
  const levels = Object.keys((target && (target.model.reasoningEfforts || target.provider.reasoningEfforts)) || {});
  const rank = (level) => (AI_EFFORT_ORDER.indexOf(level) + 1 || 99);
  return levels.sort((a, b) => rank(a) - rank(b));
}

/** The effort to send: the user's last choice when this model offers it, else the provider's default. */
function aiEffort(target = aiCurrent()) {
  const levels = aiEfforts(target);
  if (!levels.length) return ""; // this model has no Effort menu
  return [state.settings.aiEffort, target.provider.reasoning].find((level) => levels.includes(level)) || levels[0];
}

function updateAiModelLabel() {
  const target = aiCurrent();
  const effort = aiEffort(target);
  el.aiModelName.textContent = aiModelName(target);
  el.aiEffortLabel.textContent = aiEffortName(effort);
  el.aiEffortLabel.hidden = !effort;
}

async function loadAiProviders() {
  try {
    state.ai.providers = await invoke("providers_list");
  } catch (err) {
    toast(`Couldn't load model providers. ${err}`, "error");
  }
  // First usable model becomes the default so a fresh setup can chat right away.
  if (!aiProviderById(state.settings.aiProvider)?.models.some((model) => model.id === state.settings.aiModel)) {
    const provider = state.ai.providers.find(aiUsable);
    if (provider) Object.assign(state.settings, { aiProvider: provider.id, aiModel: provider.models[0].id });
  }
  renderAiProviders();
  applySettings();
}

function setAiModel(providerId, modelId) {
  const provider = aiProviderById(providerId);
  if (!provider?.models.some((model) => model.id === modelId)) return;
  Object.assign(state.settings, { aiProvider: providerId, aiModel: modelId });
  const chat = state.ai.chat;
  if (chat) Object.assign(chat, { provider: providerId, model: modelId });
  setAiEffort(aiEffort()); // keeps the effort valid for the new model, saves and repaints
}

function setAiEffort(value) {
  if (value && !aiEfforts(aiCurrent()).includes(value)) return;
  if (value) state.settings.aiEffort = value;
  const chat = state.ai.chat;
  if (chat) {
    chat.effort = value;
    chat.updatedAt = new Date().toISOString();
    saveAiChat();
  }
  applySettings();
  updateAiChrome();
}

function openAiEffortMenu(anchor) {
  const target = aiCurrent();
  const effort = aiEffort(target);
  const providers = state.ai.providers.filter(aiUsable);
  const count = providers.reduce((n, provider) => n + provider.models.length, 0);
  let html = "";
  if (aiEfforts(target).length) {
    html += `<div class="ai-menu-label">Reasoning effort</div>` + aiEfforts(target).map((level) =>
      `<button role="menuitemradio" data-effort="${escapeHtml(level)}" aria-checked="${level === effort}">${svg("check")}<span>${escapeHtml(aiEffortName(level))}</span><span class="ai-menu-desc">${AI_EFFORT_INFO[level]?.[1] || ""}</span></button>`).join("");
  }
  if (count > 10) html += `<input class="ai-menu-filter" type="text" placeholder="Search models" spellcheck="false" aria-label="Search models" />`;
  for (const provider of providers) {
    html += `<div class="ai-menu-label" data-group="${escapeHtml(provider.id)}">${escapeHtml(provider.name || provider.id)}</div>` + provider.models.map((model) =>
      `<button role="menuitemradio" data-provider="${escapeHtml(provider.id)}" data-model="${escapeHtml(model.id)}" title="${escapeHtml(model.id)}"
        aria-checked="${target?.provider.id === provider.id && target.model.id === model.id}">${svg("check")}<span>${escapeHtml(model.name || model.id)}</span></button>`).join("");
  }
  if (!providers.length) html += `<div class="ai-menu-label">No models yet</div>`;
  html += `<button data-ai-action="settings">${svg("settings")}<span>Manage model providers…</span></button>`;
  el.aiMenu.innerHTML = html;
  el.aiMenu.hidden = false;
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  const menuRect = el.aiMenu.getBoundingClientRect();
  const left = Math.min(innerWidth - menuRect.width - 8, Math.max(8, rect.right - menuRect.width));
  const top = rect.bottom + 6 + menuRect.height < innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - menuRect.height - 6);
  Object.assign(el.aiMenu.style, { left: `${left}px`, top: `${top}px` });
  (el.aiMenu.querySelector(".ai-menu-filter") || el.aiMenu.querySelector('[aria-checked="true"]'))?.focus();
}

function closeAiEffortMenu() {
  el.aiMenu.hidden = true;
  $('[data-action="ai-effort-menu"]')?.setAttribute("aria-expanded", "false");
}

function aiKeyStatus(provider) {
  const models = provider.models.length ? `${provider.models.length} ${provider.models.length === 1 ? "model" : "models"}` : "no models yet — fetch them";
  if (provider.noKey) return `No key needed · ${models}`;
  const preview = provider.keyPreview ? ` ${provider.keyPreview}` : "";
  const where = {
    environment: `Key from $${provider.apiKeyEnv}`,
    keychain: `Key${preview} in your system keychain`,
    file: `Key${preview} in a private file (no system keychain answered)`,
    ".env": "Key from the project's .env",
  }[provider.keySource];
  return where ? `${where} · ${models}` : "No key yet — add one to use this provider.";
}

function renderAiProviders() {
  const shown = state.ai.providers.filter((provider) => provider.hasKey || !provider.builtin || (provider.noKey && provider.models.length));
  el.aiProviders.innerHTML = shown.map((provider) => {
    const name = escapeHtml(provider.name || provider.id);
    return `<div class="ai-prov" data-provider="${escapeHtml(provider.id)}">
      <div class="ai-prov-head"><b>${name}</b><span class="ai-model-id">${escapeHtml(provider.id)}</span><span class="st-spacer"></span>
        <button class="btn btn-ghost" data-prov-act="fetch">Fetch available models</button>
        <button class="btn btn-ghost" data-prov-act="remove">Remove</button></div>
      <div class="row-desc ai-key-status ${aiUsable(provider) ? "ok" : "warn"}">${escapeHtml(aiKeyStatus(provider))}</div>
      ${provider.noKey ? "" : `<div class="ai-key-box"><label class="search-field ai-key-field"><input type="password" placeholder="${provider.hasKey ? "Replace API key" : "Paste API key"}" autocomplete="off" spellcheck="false" aria-label="${name} API key" /></label>
        <button class="btn" data-prov-act="key">Save</button></div>`}
    </div>`;
  }).join("") || `<p class="row-desc ai-prov-empty">No provider yet. Add one to start chatting with Mark.</p>`;
}

async function fetchAiModels(id, { quiet = false } = {}) {
  try {
    const provider = await invoke("provider_fetch_models", { id });
    if (!quiet) toast(`${provider.models.length} models from ${provider.name || provider.id}.`);
    return true;
  } catch (err) {
    toast(String(err), "error");
    return false;
  }
}

async function aiProviderAction(id, act, row) {
  const provider = aiProviderById(id);
  if (!provider) return;
  try {
    if (act === "fetch") await fetchAiModels(id);
    if (act === "remove") {
      await invoke("provider_delete", { id });
      toast(`${provider.name || id} removed, together with its saved key.`);
    }
    if (act === "key") {
      const input = $("input", row);
      const key = input.value.trim();
      if (!key) { input.focus(); return; }
      await invoke("provider_set_key", { id, key });
      toast("API key saved.");
      if (!provider.models.length) await fetchAiModels(id, { quiet: true });
    }
  } catch (err) {
    toast(String(err), "error");
  }
  await loadAiProviders();
}

el.aiProviders.addEventListener("click", (e) => {
  const button = e.target.closest("[data-prov-act]");
  if (button) aiProviderAction(button.closest(".ai-prov").dataset.provider, button.dataset.provAct, button.closest(".ai-prov"));
});
el.aiProviders.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.target.tagName !== "INPUT") return;
  e.preventDefault();
  aiProviderAction(e.target.closest(".ai-prov").dataset.provider, "key", e.target.closest(".ai-prov"));
});

// "Add model provider": a shipped provider needs only a key; anything else is a custom API.
const prov = { tab: "builtin", builtin: "", api: "openai-completions" };

function paintProviderDialog() {
  for (const button of $$("[data-prov-tab]", el.provDlg)) button.setAttribute("aria-checked", String(button.dataset.provTab === prov.tab));
  for (const pane of $$("[data-prov-pane]", el.provDlg)) pane.hidden = pane.dataset.provPane !== prov.tab;
  for (const button of $$("[data-prov-builtin]", el.provDlg)) button.setAttribute("aria-checked", String(button.dataset.provBuiltin === prov.builtin));
  for (const button of $$("[data-prov-api]", el.provDlg)) button.setAttribute("aria-checked", String(button.dataset.provApi === prov.api));
  const provider = aiProviderById(prov.builtin);
  $(".prov-builtin-key", el.provDlg).hidden = !provider || provider.noKey;
  $(".prov-note", el.provDlg).textContent = !provider ? "Every shipped provider is already set up."
    : provider.noKey ? `Uses the server at ${provider.baseURL}. Start it first; its installed models are listed automatically.`
      : `Requests go to ${provider.baseURL}. The key is stored in your system keychain.`;
}

function openProviderDialog() {
  const builtins = state.ai.providers.filter((provider) => provider.builtin);
  $(".prov-builtins", el.provDlg).innerHTML = builtins.map((provider) =>
    `<button role="radio" data-prov-builtin="${escapeHtml(provider.id)}">${escapeHtml(provider.name || provider.id)}</button>`).join("");
  Object.assign(prov, { tab: "builtin", builtin: (builtins.find((provider) => !aiUsable(provider)) || builtins[0])?.id || "", api: "openai-completions" });
  for (const input of $$("input, textarea", el.provDlg)) input.value = "";
  paintProviderDialog();
  el.provDlg.returnValue = "cancel";
  el.provDlg.showModal();
}

async function addProvider() {
  let id = prov.builtin;
  let key = $(".prov-key", el.provDlg).value.trim();
  if (prov.tab === "custom") {
    id = $(".prov-id", el.provDlg).value.trim();
    key = $(".prov-custom-key", el.provDlg).value.trim();
    const models = $(".prov-models", el.provDlg).value.split(/[\n,]/).map((line) => line.trim()).filter(Boolean).map((model) => ({ id: model }));
    if (aiProviderById(id)) throw new Error(`“${id}” already exists. Pick another Provider ID.`);
    await invoke("provider_save", { provider: { id, name: id, api: prov.api, baseURL: $(".prov-url", el.provDlg).value.trim(), noKey: !key, models } });
  } else if (!id) {
    throw new Error("Pick a provider.");
  } else if (!key && !aiProviderById(id).noKey && !aiProviderById(id).hasKey) {
    throw new Error("Paste an API key.");
  }
  if (key) await invoke("provider_set_key", { id, key });
  await loadAiProviders();
  if (!aiProviderById(id)?.models.length || prov.tab === "builtin") await fetchAiModels(id);
  await loadAiProviders();
}

el.provDlg.addEventListener("click", async (e) => {
  const pick = e.target.closest("[data-prov-tab], [data-prov-builtin], [data-prov-api]");
  if (pick) {
    Object.assign(prov, { tab: pick.dataset.provTab || prov.tab, builtin: pick.dataset.provBuiltin || prov.builtin, api: pick.dataset.provApi || prov.api });
    paintProviderDialog();
    return;
  }
  const button = e.target.closest("button[value]");
  if (!button) return;
  if (button.value !== "add") { el.provDlg.close("cancel"); return; }
  button.disabled = true;
  try {
    await addProvider();
    el.provDlg.close("add");
  } catch (err) {
    toast(String(err?.message || err), "error");
  } finally {
    button.disabled = false;
  }
});

function hideSelChip() {
  el.aiSelChip.hidden = true;
  state.ai.chip = null;
}

function showSelChip(info, anchorRect, point) {
  state.ai.chip = info;
  const label = info.kind === "reply" ? (info.role === "assistant" ? "Reply Mark" : "Reply") : "Ask Mark";
  $(".ai-selchip-label", el.aiSelChip).textContent = label;
  el.aiSelChip.setAttribute("aria-label", label);
  el.aiSelChip.hidden = false;
  const chip = el.aiSelChip.getBoundingClientRect();
  const centerX = point?.x ?? anchorRect.left + anchorRect.width / 2;
  const bottom = point?.y ?? anchorRect.bottom;
  const top = bottom + chip.height + 8 < innerHeight ? bottom + 8 : Math.max(8, (anchorRect?.top ?? bottom) - chip.height - 8);
  const left = Math.max(8, Math.min(innerWidth - chip.width - 8, centerX - chip.width / 2));
  el.aiSelChip.style.left = `${left}px`;
  el.aiSelChip.style.top = `${top}px`;
}

function headingTrail(node) {
  let found = null;
  for (const heading of $$("h1,h2,h3,h4,h5,h6", el.preview)) {
    if (heading === node || heading.contains(node)) {
      found = heading;
      break;
    }
    if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading;
    else break;
  }
  return found?.textContent.trim() || null;
}

function checkPreviewSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return hideSelChip();
  const text = selection.toString().trim();
  if (!text || text.length > 4000) return hideSelChip();
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!ancestor || !el.preview.contains(ancestor)) return hideSelChip();
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return hideSelChip();
  showSelChip({ text, heading: headingTrail(ancestor), source: "preview", kind: "ask" }, rect);
}

function askMarkFromChip() {
  const info = state.ai.chip;
  if (!info || info.kind === "reply") return;
  hideSelChip();
  openAiPanel({ focus: false });
  state.ai.selection = info;
  updateAiChrome();
  const prompt = "Explain this selection in the context of the document.";
  if (!el.aiInput.value.trim()) {
    el.aiInput.value = prompt;
    aiAutoGrow();
    el.aiInput.select();
  }
  el.aiInput.focus();
}

function replyMarkFromChip() {
  const info = state.ai.chip;
  if (!info || info.kind !== "reply") return;
  hideSelChip();
  state.ai.reply = {
    text: info.text,
    role: info.role,
    messageIndex: info.messageIndex,
    snippet: info.text.slice(0, 120),
  };
  updateAiChrome();
  const prompt = "Can you explain this part further?";
  if (!el.aiInput.value.trim()) {
    el.aiInput.value = prompt;
    aiAutoGrow();
    el.aiInput.select();
  }
  el.aiInput.focus();
}

function checkChatSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const text = selection.toString().trim();
  if (!text || text.length > 4000) return;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!ancestor || !el.aiMessages.contains(ancestor)) return;
  const messageNode = ancestor.closest(".ai-msg");
  if (!messageNode) return;
  const messageIndex = Number(messageNode.dataset.i);
  const message = state.ai.chat?.messages[messageIndex];
  if (!message) return;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  showSelChip({ kind: "reply", text, role: message.role, messageIndex, snippet: text.slice(0, 120) }, rect);
}

el.aiTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    finishAiRename(true);
  } else if (e.key === "Escape") {
    e.preventDefault();
    finishAiRename(false);
  }
});
el.aiTitleInput.addEventListener("blur", () => { if (!el.aiTitleInput.hidden) finishAiRename(true); });

el.aiComposer.addEventListener("submit", (e) => {
  e.preventDefault();
  sendAiMessage(el.aiInput.value);
});
el.aiInput.addEventListener("input", aiAutoGrow);
el.aiInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendAiMessage(el.aiInput.value);
  } else if (e.key === "Escape" && state.ai.streaming) {
    e.preventDefault();
    e.stopPropagation();
    stopAi();
  }
});

el.aiMessages.addEventListener("click", (e) => {
  const link = e.target.closest(".chat-md a[href]");
  if (link) {
    e.preventDefault();
    const href = link.getAttribute("href");
    if (/^(https?:|mailto:)/i.test(href)) opener.openUrl(href).catch(() => toast("Couldn't open that link.", "error"));
    return;
  }
  const suggestion = e.target.closest("[data-ai-prompt]");
  if (suggestion) {
    sendAiMessage(suggestion.dataset.aiPrompt);
    return;
  }
  const action = e.target.closest("[data-ai-action]");
  if (action?.dataset.aiAction === "retry") {
    action.closest(".ai-error")?.remove();
    requestAssistant();
  } else if (action?.dataset.aiAction === "settings") {
    closeAiPanel();
    openSettings();
  }
  const copy = e.target.closest("[data-ai-copy]");
  if (copy) {
    const index = Number(copy.closest(".ai-msg")?.dataset.i);
    const message = state.ai.chat?.messages[index];
    if (message?.content) {
      navigator.clipboard.writeText(message.content).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1200);
      });
    }
  }
});
el.aiMessages.addEventListener("scroll", () => {
  state.ai.pinned = el.aiMessages.scrollHeight - el.aiMessages.scrollTop - el.aiMessages.clientHeight < 90;
});

el.aiHistoryList.addEventListener("click", (e) => {
  const rename = e.target.closest("[data-ai-rename-chat]");
  if (rename) {
    if (state.ai.streaming) {
      toast("Stop Mark first.", "error");
      return;
    }
    openAiChat(rename.dataset.aiRenameChat, rename.dataset.chatDate).then((ok) => { if (ok) startAiRename(); });
    return;
  }
  const remove = e.target.closest("[data-ai-delete-chat]");
  if (remove) {
    askDeleteAiChat(remove.dataset.aiDeleteChat, remove.dataset.chatDate);
    return;
  }
  const row = e.target.closest("[data-chat-id]");
  if (row) openAiChat(row.dataset.chatId, row.dataset.chatDate);
});
el.aiHistoryList.addEventListener("keydown", (e) => {
  const row = e.target.closest("[data-chat-id]");
  if (row && !e.target.closest("button") && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    openAiChat(row.dataset.chatId, row.dataset.chatDate);
  }
});

el.aiMenu.addEventListener("click", (e) => {
  const button = e.target.closest("[data-effort], [data-model], [data-ai-action]");
  if (!button) return;
  if (button.dataset.effort) setAiEffort(button.dataset.effort);
  else if (button.dataset.model) setAiModel(button.dataset.provider, button.dataset.model);
  else openSettings();
  closeAiEffortMenu();
});
el.aiMenu.addEventListener("input", (e) => {
  if (!e.target.classList.contains("ai-menu-filter")) return;
  const query = e.target.value.trim().toLowerCase();
  for (const button of $$("[data-model]", el.aiMenu)) button.hidden = !`${button.textContent} ${button.dataset.model}`.toLowerCase().includes(query);
  for (const label of $$("[data-group]", el.aiMenu)) label.hidden = !$(`[data-provider="${CSS.escape(label.dataset.group)}"]:not([hidden])`, el.aiMenu);
});
document.addEventListener("mousedown", (e) => {
  if (el.aiMenu.hidden) return;
  if (!e.target.closest(".ai-menu") && !e.target.closest('[data-action="ai-effort-menu"]')) closeAiEffortMenu();
});


el.aiSelChip.addEventListener("click", () => {
  if (state.ai.chip?.kind === "reply") replyMarkFromChip();
  else askMarkFromChip();
});
el.previewPane.addEventListener("pointerup", () => setTimeout(checkPreviewSelection, 0));
el.previewPane.addEventListener("keyup", () => setTimeout(checkPreviewSelection, 0));
el.editor.addEventListener("pointerup", (e) => {
  setTimeout(() => {
    const start = el.editor.selectionStart;
    const end = el.editor.selectionEnd;
    if (start === end) return hideSelChip();
    const text = el.editor.value.slice(start, end).trim();
    if (!text || text.length > 4000) return hideSelChip();
    const lineOf = (position) => el.editor.value.slice(0, position).split("\n").length;
    showSelChip({ text, lines: [lineOf(start), lineOf(end)], source: "editor", kind: "ask" }, null, { x: e.clientX, y: e.clientY });
  }, 0);
});
el.previewPane.addEventListener("scroll", hideSelChip);
el.editor.addEventListener("scroll", hideSelChip);
el.aiMessages.addEventListener("pointerup", () => setTimeout(checkChatSelection, 0));
el.aiMessages.addEventListener("keyup", () => setTimeout(checkChatSelection, 0));
el.aiMessages.addEventListener("scroll", hideSelChip);
addEventListener("resize", hideSelChip);
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".ai-selchip")) hideSelChip(); }, true);
document.addEventListener("selectionchange", debounce(() => {
  if (!el.aiSelChip.hidden) {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) hideSelChip();
  }
}, 200));

el.aiSplitter.addEventListener("pointerdown", (e) => {
  el.aiSplitter.setPointerCapture(e.pointerId);
  el.aiSplitter.classList.add("dragging");
  const right = el.aiPanel.getBoundingClientRect().right;
  const move = (event) => {
    const width = Math.round(Math.min(560, Math.max(300, right - event.clientX)));
    el.root.style.setProperty("--ai-w", `${width}px`);
  };
  const up = () => {
    el.aiSplitter.classList.remove("dragging");
    el.aiSplitter.removeEventListener("pointermove", move);
    store.set("aiW", getComputedStyle(el.root).getPropertyValue("--ai-w").trim());
  };
  el.aiSplitter.addEventListener("pointermove", move);
  el.aiSplitter.addEventListener("pointerup", up, { once: true });
});
el.aiSplitter.addEventListener("dblclick", () => {
  el.root.style.removeProperty("--ai-w");
  store.set("aiW", null);
});

// ---------- window integration ----------
async function syncMaximized() {
  const max = await appWindow.isMaximized();
  el.root.dataset.maximized = String(max);
  el.maxBtn.setAttribute("href", max ? "#i-restore" : "#i-max");
}
appWindow.onResized(syncMaximized);

appWindow.onCloseRequested(async (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  if (await settleUnsaved()) await appWindow.destroy();
});

webview.onDragDropEvent((e) => {
  const t = e.payload.type;
  if (t === "enter" || t === "over") el.drop.hidden = false;
  else el.drop.hidden = true;
  if (t === "drop") {
    const p = e.payload.paths.find((x) => MD_RE.test(x));
    if (p) openFile(p);
    else if (e.payload.paths.length) toast("Only Markdown files (.md, .markdown, .mdx) can be opened.", "error");
  }
});

// Other tools (git, another editor, an AI agent) change files while this window sits in the background:
// on return, show what is on disk. Unsaved edits are never replaced, only flagged.
let diskWarned = null; // disk content already warned about, so refocusing doesn't repeat the toast
async function checkDisk() {
  const p = state.path;
  if (!p) return;
  let text;
  try { text = await invoke("read_file", { path: p }); } catch { return; } // deleted or unreadable: keep the buffer
  if (p !== state.path || text === state.saved) return;
  if (text === state.text) { state.saved = text; return updateChrome(); } // e.g. our own save still in flight
  if (isDirty()) {
    if (diskWarned !== text) toast(`“${baseName(p)}” changed on disk. Saving will overwrite those changes.`, "error");
    diskWarned = text;
    return;
  }
  const tops = [el.editor.scrollTop, el.previewPane.scrollTop];
  Object.assign(state, { saved: text, text });
  el.editor.value = text;
  resetHistory();
  await renderPreview();
  [el.editor.scrollTop, el.previewPane.scrollTop] = tops;
  updateChrome();
  renderSidebar();
  if (!el.findbar.hidden) runFind(el.findInput.value, { keepIndex: true, scroll: false });
}

addEventListener("focus", () => {
  checkDisk();
  if (!state.folder) return;
  const dir = state.folder;
  invoke("list_markdown", { dir }).then((tree) => {
    if (dir !== state.folder || JSON.stringify(tree) === JSON.stringify(state.tree)) return;
    state.tree = tree;
    renderSidebar();
  }, () => { /* folder gone: keep the last listing */ });
});

// ---------- boot ----------
(async function boot() {
  applySettings();
  const w = store.get("sidebarW", null);
  if (w) el.root.style.setProperty("--sidebar-w", w);
  if (!narrow.matches && store.get("sidebarClosed", false)) el.win.dataset.sidebar = "closed";
  // A window opened via New Window (?fresh=1) starts blank: no CLI-arg file, no last-file restore.
  const fresh = new URLSearchParams(location.search).has("fresh");
  const initialReq = fresh ? Promise.resolve(null) : invoke("initial_file"); // start the document fetch before anything else
  renderSidebar();
  syncMaximized();
  const aiW = store.get("aiW", null);
  if (aiW) el.root.style.setProperty("--ai-w", aiW);
  if (store.get("aiOpen", false)) openAiPanel({ focus: false });
  loadAiProviders();
  loadAiMemory();
  if (state.folder) loadTree().catch(() => setFolder(null));
  // Path shortening (~) is cosmetic: apply it when it arrives instead of waiting on it.
  tpath.homeDir().then((home) => {
    state.home = home.replace(/[\\/]$/, "");
    state.sep = tpath.sep();
    renderSidebar();
    renderWelcome();
    if (state.path) updateChrome();
  }, () => { /* fall back to full paths */ });
  const initial = fresh ? null : (await initialReq) || (state.settings.startup === "last" ? store.get("lastFile", null) : null);
  // A missing last file is not worth an error on startup; the welcome screen stays hidden until known.
  if (!initial || !(await openFile(initial, { quiet: true }))) {
    renderWelcome();
    el.welcome.hidden = false;
  }
})();
