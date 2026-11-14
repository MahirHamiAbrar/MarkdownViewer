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

if (typeof module !== "undefined") {
  module.exports = { scanSource, continuation };
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
    console.log("mdsource ok");
  }
}
