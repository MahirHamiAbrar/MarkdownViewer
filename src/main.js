"use strict";

const { invoke, convertFileSrc } = window.__TAURI__.core;
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
  suggestions: $(".suggestions"),
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
};

const MD_RE = /\.(md|markdown|mdx)$/i;
const MAX_RECENTS = 30;
const ACCENTS = {
  blue: "#2A7BEF", red: "#F0505F", green: "#2FB458", purple: "#7B5CF5",
  pink: "#D14FA8", orange: "#FF9A2E", graphite: "#454C5C",
};
// Setting -> [CSS variable, what it falls back to]
const FONT_VARS = { fontUi: ["--font-ui", "--font-ui-base"], fontEditor: ["--font-editor", "--font-mono"], fontView: ["--font-view", "--font-ui"] };
const TILE_COLORS = ["#2F80F5", "#F5822E", "#27B5C9", "#8C7CF0", "#F26B8A", "#4F7CF0", "#35B864", "#6B7384"];

// ---------- persistence (localStorage, per-viewer conveniences) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const state = {
  path: null,       // open file
  saved: "",        // content on disk
  text: "",         // content in editor
  mode: store.get("mode", "read"),
  recents: store.get("recents", []),
  folder: store.get("folder", null),
  tree: [],
  expanded: new Set(),
  settings: { theme: "system", accent: "blue", fontSize: "13", width: "normal", fontUi: "", fontEditor: "", fontView: "", ...store.get("settings", {}) },
  home: "",
  sep: "/",
};

// ---------- small helpers ----------
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const svg = (name) => `<svg><use href="#i-${name}"/></svg>`;
const baseName = (p) => p.split(/[\\/]/).pop();
const dirName = (p) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))) || p;
const isDirty = () => state.path !== null && state.text !== state.saved;

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
  el.root.style.setProperty("--read-w", s.width === "wide" ? "980px" : "760px");
  for (const [key, [cssVar, fallback]] of Object.entries(FONT_VARS)) {
    const name = s[key].replace(/["\\]/g, "");
    if (name) el.root.style.setProperty(cssVar, `"${name}", var(${fallback})`);
    else el.root.style.removeProperty(cssVar);
  }
  for (const seg of $$("[data-setting]")) {
    for (const b of $$("button", seg)) b.setAttribute("aria-checked", String(b.dataset.value === s[seg.dataset.setting]));
  }
  for (const b of $$(".swatch")) b.setAttribute("aria-checked", String(b.dataset.accent === s.accent));
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
  if (seg) state.settings[seg.parentElement.dataset.setting] = seg.dataset.value;
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
  el.settingsDlg.showModal();
  if (fontsLoaded) return;
  fontsLoaded = true;
  invoke("list_fonts").then((list) => {
    fonts = list;
    if (!el.fontMenu.hidden) showFontMenu(fontMenu.input);
  }, () => { fontsLoaded = false; });
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
  $("h2", el.confirmDlg).textContent = `Save changes to “${baseName(state.path)}”?`;
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
  Object.assign(state, { path: p, saved: text, text });
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
  if (!state.path) return false;
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

function decoratePreview(root) {
  for (const a of $$("a[href]", root)) {
    if (/^(https?:|mailto:)/i.test(a.getAttribute("href"))) a.classList.add("external");
  }
  for (const img of $$("img[src]", root)) {
    const src = img.getAttribute("src");
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !src.startsWith("file:")) continue;
    try { img.src = convertFileSrc(resolveLocal(src)); } catch { /* leave the broken image as-is */ }
  }
  for (const pre of $$("pre", root)) {
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.append(pre);
    // Info strings like "ts#index.ts" name the file after the language.
    const info = ($("code", pre)?.className.match(/language-(\S+)/) || [])[1] || "";
    const [, lang, file] = info.match(/^(.*?)(?:#(.+))?$/);
    if (lang === "mermaid") {
      wrap.classList.add("mermaid-block");
      wrap.dataset.src = pre.textContent;
      renderMermaid(wrap);
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
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
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
  const name = state.path ? baseName(state.path) : "Markdown";
  shownDirty = isDirty();
  el.docName.textContent = name;
  el.docName.title = state.path || "";
  el.dirty.hidden = !shownDirty;
  el.win.toggleAttribute("data-dirty", shownDirty); // marks the open file in the sidebar
  document.title = `${shownDirty ? "• " : ""}${name}`;
  el.stPath.textContent = state.path ? prettyDir(state.path) + state.sep + name : "";
  el.stPath.title = state.path || "";
  updateStatus();
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
// Typing does the minimum synchronously; the preview follows live (never saved until Ctrl S).
const wordsSoon = debounce(updateWords, 400);
const findSoon = debounce(() => runFind(el.findInput.value, { keepIndex: true, scroll: false }), 150);
const renderSoon = debounce(renderPreview, 120); // bursts of typing coalesce into one render
function editorChanged() {
  state.text = el.editor.value;
  driver = el.editor;
  if (isDirty() !== shownDirty) updateChrome();
  if (state.mode === "split") renderSoon(); // read mode re-renders on switch, edit mode has no preview
  wordsSoon();
  if (!el.findbar.hidden) findSoon();
}
el.editor.addEventListener("input", () => { if (!restoring) recordEdit(); editorChanged(); });
el.editor.addEventListener("keyup", updatePos);
el.editor.addEventListener("scroll", () => { el.editorHl.scrollTop = el.editor.scrollTop; });
el.editor.addEventListener("click", updatePos);
el.editor.addEventListener("keydown", (e) => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
  const k = e.key.toLowerCase();
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
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
  html += `<div class="group-label"><span>Recent</span></div>`;
  html += state.recents.length
    ? state.recents.map((p) => navItem({
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
  if (item.dataset.dir) {
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
  if (!item) return;
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

// ---------- welcome ----------
function renderWelcome() {
  el.suggestions.innerHTML = state.recents.slice(0, 3).map((p) =>
    `<button class="suggestion" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">
      <span class="icon-tile" style="--tile:${tileColor(p)}">${svg("file")}</span>
      <span class="nav-text"><span class="nav-name">${escapeHtml(baseName(p))}</span><span class="nav-sub">${escapeHtml(prettyDir(p))}</span></span>
      ${svg("chevron")}</button>`).join("");
}
el.suggestions.addEventListener("click", (e) => {
  const b = e.target.closest("[data-path]");
  if (b) openFile(b.dataset.path);
});

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
  "close-folder": () => { state.folder = null; store.set("folder", null); loadTree(); },
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
  if (!state.path) return;
  closeFind();
  await renderPreview(); // make sure the printed preview matches the editor
  try { await invoke("print_page"); } catch (err) { toast(`Couldn't open the print dialog. ${err}`, "error"); }
}

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape" && el.win.dataset.sidebar === "overlay") el.win.dataset.sidebar = "";
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
  const run = {
    o: () => (e.shiftKey ? pickFolder() : pickFile()),
    s: () => save().then((ok) => ok && toast("Saved")),
    f: () => (e.shiftKey ? (el.win.dataset.sidebar === "closed" && toggleSidebar(), narrow.matches && (el.win.dataset.sidebar = "overlay"), el.sbSearch.focus(), el.sbSearch.select()) : openFind()),
    h: () => openFind(undefined, { replace: true }),
    p: exportPdf,
    e: () => state.path && setMode({ read: "split", split: "edit", edit: "read" }[state.mode]),
    b: toggleSidebar,
    ",": actions.settings,
  }[k];
  if (run) { e.preventDefault(); run(); }
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

// ---------- boot ----------
(async function boot() {
  applySettings();
  const w = store.get("sidebarW", null);
  if (w) el.root.style.setProperty("--sidebar-w", w);
  if (!narrow.matches && store.get("sidebarClosed", false)) el.win.dataset.sidebar = "closed";
  const initialReq = invoke("initial_file"); // start the document fetch before anything else
  renderSidebar();
  syncMaximized();
  if (state.folder) loadTree().catch(() => setFolder(null));
  // Path shortening (~) is cosmetic: apply it when it arrives instead of waiting on it.
  tpath.homeDir().then((home) => {
    state.home = home.replace(/[\\/]$/, "");
    state.sep = tpath.sep();
    renderSidebar();
    renderWelcome();
    if (state.path) updateChrome();
  }, () => { /* fall back to full paths */ });
  const initial = (await initialReq) || store.get("lastFile", null);
  // A missing last file is not worth an error on startup; the welcome screen stays hidden until known.
  if (!initial || !(await openFile(initial, { quiet: true }))) {
    renderWelcome();
    el.welcome.hidden = false;
  }
})();
