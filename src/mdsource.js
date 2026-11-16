"use strict";
// Pure helpers that read Markdown source. Loaded before main.js; `node src/mdsource.js` runs the self-check.

/**
 * Headings and task-list markers outside front matter and fenced code.
 * ponytail: line regexes, not a parser. Setext (underlined) headings and indented code blocks are
 * not recognised; use comrak's sourcepos output if that ever matters.
 */
function scanSource(text) {
  const headings = [];
  const tasks = []; // offset of the " " / "x" inside "[ ]"
  let fence = null;
  let offset = 0;
  const lines = text.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") { // front matter is shown as code
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) for (; i <= end; i++) offset += lines[i].length + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(?:>\s?)*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (!fence) {
      const h = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
      if (h && h[2]) {
        const label = h[2].replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
        if (label) headings.push({ level: h[1].length, text: label, offset });
      }
      const t = /^\s*(?:>\s?)*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/.exec(line);
      if (t) tasks.push(offset + t[0].length - 3);
    }
    offset += line.length + 1;
  }
  return { headings, tasks };
}

/**
 * What Enter should do after `line` (the text between line start and caret):
 * null = plain newline, { clear } = drop the empty list/quote marker, { insert } = newline + this prefix.
 */
function continuation(line) {
  const m = /^(\s*(?:>\s?)*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (m) {
    if (!m[5]) return { clear: true };
    const num = /^(\d+)(.)$/.exec(m[2]);
    return { insert: m[1] + (num ? Number(num[1]) + 1 + num[2] : m[2]) + m[3] + (m[4] ? "[ ] " : "") };
  }
  const q = /^(\s*(?:>\s?)*)(.*)$/.exec(line);
  if (!q[1]) return null;
  if (!q[2]) return q[1].includes(">") ? { clear: true } : null;
  return { insert: q[1] };
}

/**
 * LaTeX `\( … \)` and `\[ … \]` rewritten as `$…$` / `$$…$$`, which comrak's math extension knows.
 * Fenced code and code spans are left alone. Used for chat answers only: in documents `\[` and `\(`
 * are ordinary Markdown escapes (`\[citation needed\]`).
 */
function texDelimiters(text) {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  const inline = (s) => s.replace(/(`+)[\s\S]*?\1|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g,
    (m, code, display, math) => (code ? m : display != null ? `$$${display.trim()}$$` : `$${math.trim()}$`));
  const out = [];
  let chunk = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const f = /^\s{0,3}(?:>\s?)*(`{3,}|~{3,})/.exec(line);
    if (f && (!fence || (f[1][0] === fence[0] && f[1].length >= fence.length))) {
      if (!fence && chunk.length) { out.push(inline(chunk.join("\n"))); chunk = []; }
      fence = fence ? null : f[1];
      out.push(line);
    } else if (fence) out.push(line);
    else chunk.push(line);
  }
  if (chunk.length) out.push(inline(chunk.join("\n")));
  return out.join("\n");
}

// ---------- editor syntax colors ----------
// The editor colors one line at a time. What carries from line to line is the block state:
// "" (plain Markdown), "fm" (front matter), "$$" (display math), or the open fence ("```", "~~~~").

const FENCE = /^(\s{0,3}(?:>\s?)*)(`{3,}|~{3,})(.*)$/;

/** Block state after `line`, given the state before it. `first`: line 0, where front matter can start. */
function nextState(line, st, first = false) {
  if (st === "fm") return /^(---|\.\.\.)\s*$/.test(line) ? "" : "fm";
  if (st === "$$") return line.includes("$$") ? "" : "$$";
  const f = FENCE.exec(line);
  if (st) return f && f[2][0] === st[0] && f[2].length >= st.length && !f[3].trim() ? "" : st;
  if (f) return f[2];
  if (first && line.trim() === "---") return "fm";
  if (/^\s*(?:>\s?)*\$\$/.test(line) && !/\$\$.*\$\$/.test(line)) return "$$";
  return "";
}

/** Block state at the end of `text`. */
function blockState(text) {
  let st = "";
  text.split("\n").forEach((line, i) => { st = nextState(line, st, i === 0); });
  return st;
}

/**
 * For Enter at `at`, the end of the line starting at `ls`: if that line opens a code fence or a `$$`
 * block that nothing closes, { indent, close } to put the caret in a fresh block. Otherwise null.
 */
function closeBlock(text, ls, at) {
  const line = text.slice(ls, at);
  const m = FENCE.exec(line) || /^(\s*(?:>\s?)*)(\$\$)()\s*$/.exec(line);
  if (!m || (m[2][0] === "`" && m[3].includes("`"))) return null;
  if (blockState(text.slice(0, ls)) || !blockState(text)) return null; // this line closes a block, or one below closes it
  return { indent: m[1], close: m[1] + m[2] };
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const tok = (cls, s) => (s ? `<span class="md-${cls}">${esc(s)}</span>` : "");

// One alternative per inline construct; at any position the first that matches wins.
// No lookbehind: older WebKit (macOS before Safari 16.4) rejects it, and this file would fail to load.
const INLINE = new RegExp([
  /(?<code>(?<tk>`+).+?\k<tk>(?!`))/,
  /(?<math>\$\$.+?\$\$|\$[^\s$](?:[^$]*?[^\s$\\])?\$(?!\d))/,
  /(?<esc>\\[!-/:-@[-`{-~])/,
  /(?<html><!--.*?-->|<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/,
  /(?<auto><(?:https?|mailto|ftp):[^<>\s]+>|\b(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?"')\]*_~])/,
  /(?<link>!?\[[^\]]*\]\([^)]*\)|!?\[[^\]]+\]\[[^\]]*\]|\[\^[^\]]+\])/,
  /(?<strong>(?<sd>\*\*|__)(?=\S).*?\S\k<sd>)/,
  /(?<del>~~(?=\S).*?\S~~)/,
  /(?<em>\*(?![\s*])(?:[^*]*?[^\s*\\])?\*(?!\*)|_(?![\s_])(?:[^_]*?[^\s_\\])?_(?![\p{L}\p{N}_]))/,
  /(?<pipe>\|)/,
].map((r) => r.source).join("|"), "gu");

/** Inline Markdown as HTML spans. Emphasis and link text are colored recursively, so `**a `b`**` nests. */
function inlineHtml(s) {
  const re = new RegExp(INLINE); // its own lastIndex: this recurses
  let out = "";
  let last = 0;
  for (let m; (m = re.exec(s));) {
    const t = m[0];
    const g = m.groups;
    if (g.em && t[0] === "_" && /[\p{L}\p{N}_]/u.test(s[m.index - 1] || "")) { re.lastIndex = m.index + 1; continue; } // snake_case is not emphasis
    out += esc(s.slice(last, m.index));
    last = m.index + t.length;
    if (g.code) out += tok("code", t);
    else if (g.math) out += tok("math", t);
    else if (g.esc) out += tok("p", "\\") + esc(t[1]);
    else if (g.html) out += tok("html", t);
    else if (g.auto) out += tok("url", t);
    else if (g.link) {
      const p = /^(!?\[)([^\]]*)(\][([])(.*)([)\]])$/.exec(t);
      out += p ? `${tok("p", p[1])}<span class="md-link">${inlineHtml(p[2])}</span>${tok("p", p[3])}${tok("url", p[4])}${tok("p", p[5])}` : tok("link", t);
    } else {
      const [cls, d] = g.strong ? ["strong", 2] : g.del ? ["del", 2] : g.em ? ["em", 1] : ["p", 0];
      out += d ? `${tok("p", t.slice(0, d))}<span class="md-${cls}">${inlineHtml(t.slice(d, -d))}</span>${tok("p", t.slice(-d))}` : tok(cls, t);
    }
  }
  return out + esc(s.slice(last));
}

/** A line outside fences: headings, quotes, lists, rules and link definitions, then its inline Markdown. */
function lineHtml(line) {
  let m;
  if ((m = /^( {0,3})(#{1,6})(?=\s|$)(.*)$/.exec(line))) return `${esc(m[1])}${tok("p", m[2])}<span class="md-h">${inlineHtml(m[3])}</span>`;
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) || /^ {0,3}=+[ \t]*$/.test(line)) return tok("p", line); // rule, setext underline
  if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) return tok("p", line); // table delimiter row
  if ((m = /^(\s*>\s?)(\[!\w+\])?(.*)$/.exec(line))) return tok("li", m[1]) + tok("li", m[2]) + lineHtml(m[3]);
  if ((m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\](?=\s|$))?(.*)$/.exec(line))) return esc(m[1]) + tok("li", m[2]) + esc(m[3]) + tok("li", m[4]) + inlineHtml(m[5]);
  if ((m = /^( {0,3})(\[[^\]]+\]:)(\s*)(\S*)(.*)$/.exec(line))) return esc(m[1]) + tok("link", m[2]) + esc(m[3]) + tok("url", m[4]) + inlineHtml(m[5]);
  return inlineHtml(line);
}

/** One editor line as { html, cls }, given the block state before it. `cls` styles the whole line (code blocks). */
function highlightLine(line, st, first = false) {
  if (st === "fm" || (first && !st && nextState(line, st, true) === "fm")) {
    const k = /^(\s*[\w-]+)(:)(.*)$/.exec(line);
    const html = !st || nextState(line, st) === "" ? tok("p", line) : k ? tok("key", k[1]) + tok("p", k[2]) + esc(k[3]) : esc(line);
    return { cls: "md-fm", html };
  }
  if (st === "$$") return { cls: "", html: tok("math", line) };
  const f = FENCE.exec(line);
  if (st) return { cls: "md-cb", html: nextState(line, st) ? esc(line) : tok("p", line) };
  if (f) return { cls: "md-cb", html: esc(f[1]) + tok("p", f[2]) + tok("lang", f[3]) };
  if (nextState(line, st) === "$$") return { cls: "", html: tok("math", line) };
  return { cls: "", html: lineHtml(line) };
}

/** Comrak's heading id for `text` (before de-duplication with -1, -2, …). */
const slugify = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");

/**
 * What the editor can suggest at the caret, from the line's text `before` and `after` it:
 * null, or { kind, query, from } where `from` is where, in `before`, the text a pick replaces starts.
 * Kinds: "block" ("/" at the start of a line), "lang" (after an opening fence), "anchor" ("](#"),
 * "file" / "image" ("](" / "!["…"]("), "word" (three or more letters of a word).
 */
function suggestContext(before, after) {
  let m;
  const at = (kind, query, from = before.length - query.length) => ({ kind, query, from });
  if ((m = /^\s*(?:>\s?)*\/([\w-]*)$/.exec(before))) return at("block", m[1], before.length - m[1].length - 1);
  if ((m = /^\s{0,3}(?:>\s?)*(?:`{3,}|~{3,})([\w+#.-]+)$/.exec(before)) && !after.trim()) return at("lang", m[1]);
  if ((m = /\]\(#([^\s)]*)$/.exec(before))) return at("anchor", m[1]);
  if ((m = /(!?)\[[^\]]*\]\(([^\s)#]*)$/.exec(before))) return at(m[1] ? "image" : "file", m[2]);
  if ((m = /[\p{L}\p{N}_]{3,}$/u.exec(before)) && !/^[\p{L}\p{N}_]/u.test(after)) return at("word", m[0]);
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { scanSource, continuation, texDelimiters, nextState, blockState, closeBlock, highlightLine, slugify, suggestContext };
  if (require.main === module) {
    const assert = require("node:assert/strict");
    const src = "---\ntitle: # not a heading\n---\n# One *two*\n\n```sh\n# comment\n- [ ] not a task\n```\n## [Link](x) ##\n- [ ] a\n  1. [x] b\n> - [X] c\n";
    const { headings, tasks } = scanSource(src);
    assert.deepEqual(headings.map((h) => [h.level, h.text]), [[1, "One two"], [2, "Link"]]);
    assert.equal(src.slice(headings[1].offset, headings[1].offset + 2), "##");
    assert.deepEqual(tasks.map((o) => src[o]), [" ", "x", "X"]);
    assert.deepEqual(continuation("- item"), { insert: "- " });
    assert.deepEqual(continuation("  9. item"), { insert: "  10. " });
    assert.deepEqual(continuation("- [x] done"), { insert: "- [ ] " });
    assert.deepEqual(continuation("> - quoted"), { insert: "> - " });
    assert.deepEqual(continuation("> text"), { insert: "> " });
    assert.deepEqual(continuation("    code"), { insert: "    " });
    assert.deepEqual(continuation("- "), { clear: true });
    assert.deepEqual(continuation("> "), { clear: true });
    assert.equal(continuation("plain"), null);
    assert.equal(continuation("**bold** start"), null);
    assert.equal(continuation("   "), null);
    assert.equal(texDelimiters("by \\( \\sqrt{d_k} \\) and"), "by $\\sqrt{d_k}$ and");
    assert.equal(texDelimiters("\\[\na \\\\ b\n\\]"), "$$a \\\\ b$$");
    assert.equal(texDelimiters("`\\(x\\)` and ``a`\\[y\\]``"), "`\\(x\\)` and ``a`\\[y\\]``");
    assert.equal(texDelimiters("```\n\\(x\\)\n```\n\\(y\\)"), "```\n\\(x\\)\n```\n$y$");
    assert.equal(texDelimiters("```\n\\(open fence"), "```\n\\(open fence");
    // Syntax colors: block state carries across lines, and every line's text survives exactly.
    assert.equal(blockState("---\na: 1\n---\n```js\nx"), "```");
    assert.equal(blockState("````\n```\n````\n$$\nx"), "$$");
    assert.equal(blockState("```\n``` not a close\n"), "```");
    const plain = (h) => h.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const doc = "---\ntitle: x\n---\n# H *i* `c`\n> [!NOTE]\n> - [x] **b `c`** [l](u) ![i](p.png) <b>&</b> $x$ \\* a_b_c ~~d~~ https://e.org.\n```py\nif a < b: **x**\n```\n| a | b |\n|---|:-:|\n[r]: http://x \"t\"";
    let st = "";
    doc.split("\n").forEach((line, i) => {
      assert.equal(plain(highlightLine(line, st, i === 0).html), line);
      st = nextState(line, st, i === 0);
    });
    assert.equal(highlightLine("if a < b: **x**", "```").html, "if a &lt; b: **x**");
    assert.equal(highlightLine("**a `b`**", "").html, '<span class="md-p">**</span><span class="md-strong">a <span class="md-code">`b`</span></span><span class="md-p">**</span>');
    assert.equal(highlightLine("a_b_c and $5 or $6", "").html, "a_b_c and $5 or $6");
    assert.deepEqual(closeBlock("x\n```py", 2, 7), { indent: "", close: "```" });
    assert.equal(closeBlock("```py\n```", 6, 9), null); // closes the block above
    assert.equal(closeBlock("```py\n\n```", 0, 5), null); // already closed below
    assert.deepEqual(closeBlock("> $$", 0, 4), { indent: "> ", close: "> $$" });
    assert.equal(slugify("Hello, World! Ünïcode_x"), "hello-world-ünïcode_x");
    assert.deepEqual(suggestContext("  /tab", ""), { kind: "block", query: "tab", from: 2 });
    assert.deepEqual(suggestContext("```py", ""), { kind: "lang", query: "py", from: 3 });
    assert.equal(suggestContext("```py", "x"), null);
    assert.deepEqual(suggestContext("see [x](#intro", ")"), { kind: "anchor", query: "intro", from: 9 });
    assert.deepEqual(suggestContext("![a](img/p", ")"), { kind: "image", query: "img/p", from: 5 });
    assert.deepEqual(suggestContext("[a](", ")"), { kind: "file", query: "", from: 4 });
    assert.deepEqual(suggestContext("the quic", " fox"), { kind: "word", query: "quic", from: 4 });
    assert.equal(suggestContext("the qu", ""), null);
    assert.equal(suggestContext("the quic", "k"), null); // caret inside a word
    console.log("mdsource ok");
  }
}
