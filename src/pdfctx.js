"use strict";
// Big Brain's PDF tools. A PDF page can be real text, a scan (one big picture), or text with figures, and
// each wants different handling: the model inspects first, then asks for extracted text or for page images.
// Runs in the webview on the bundled pdf.js. Loaded before main.js; `node src/pdfctx.js` checks the pure parts.

const PDF_LIMITS = {
  inspectPages: 120, // pages examined per inspect call
  viewPages: 4,      // page images per view call
  viewEdge: 1568,    // px on the long edge of a page image
  textPage: 200,     // chars from which a page counts as having a text layer
  sparsePage: 50,    // chars up to which a page counts as having none
};

/** What a page is, from its extracted text length and its number of embedded images. */
function pdfPageKind(chars, images) {
  if (chars >= PDF_LIMITS.textPage) return images ? "text+images" : "text";
  if (chars <= PDF_LIMITS.sparsePage) return images ? "scanned" : "blank";
  return images ? "text+images" : "text";
}

/** `[{ page, chars, images }]` as one line per run of same-kind pages, plus what to do next. */
function pdfReport(name, total, pages, vision) {
  const runs = [];
  for (const p of pages) {
    const kind = pdfPageKind(p.chars, p.images);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.to === p.page - 1) Object.assign(last, { to: p.page, chars: last.chars + p.chars, images: last.images + p.images });
    else runs.push({ kind, from: p.page, to: p.page, chars: p.chars, images: p.images });
  }
  const label = {
    text: "text layer, no images",
    "text+images": "text layer with embedded images (figures, photos or charts)",
    scanned: "no text layer, page is an image (scan)",
    blank: "no text and no images (blank, or vector drawing only)",
  };
  const lines = runs.map((r) => `${r.from === r.to ? `Page ${r.from}` : `Pages ${r.from}-${r.to}`}: ${label[r.kind]}; ${r.chars} chars, ${r.images} image${r.images === 1 ? "" : "s"}`);
  const kinds = new Set(runs.map((r) => r.kind));
  const advice = [];
  if (kinds.has("text") || kinds.has("text+images")) advice.push("Read text-layer pages with pdf_text.");
  if (vision) {
    if (kinds.has("scanned")) advice.push("Scanned pages have no text to extract: look at them with pdf_view.");
    if (kinds.has("text+images")) advice.push("Use pdf_view on a page when what its images show matters to the question.");
    if (kinds.has("blank")) advice.push("A page marked blank may still hold a vector drawing: pdf_view shows it.");
  } else if (kinds.has("scanned") || kinds.has("text+images")) {
    advice.push("The current model cannot view images, so scanned pages and figures cannot be read. Say so if the answer depends on them.");
  }
  const more = total > pages.length ? `\n[Examined pages ${pages[0].page}-${pages[pages.length - 1].page} of ${total}. Call pdf_inspect with first_page to examine more.]` : "";
  return `${name}: ${total} page${total === 1 ? "" : "s"}\n${lines.join("\n")}${more}\n\n${advice.join(" ")}`;
}

/** A 1-based inclusive page range inside `total`, at most `max` pages long. */
function pdfRange(first, last, total, max) {
  const from = Math.min(Math.max(1, Math.floor(Number(first)) || 1), total);
  const to = Math.min(Math.max(from, Math.floor(Number(last)) || from), total, from + max - 1);
  return { from, to };
}

// ---- pdf.js (browser only) ----
let pdfjsLoading = null;
function loadPdfjs() {
  return (pdfjsLoading ||= import("./vendor/pdfjs/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/build/pdf.worker.mjs", document.baseURI).href;
    return lib;
  }));
}

// Documents parsed during the current answer, by path; main.js clears this when the answer ends.
const pdfOpen = new Map();
function pdfDocument(path, readBytes) {
  if (!pdfOpen.has(path)) {
    pdfOpen.set(path, (async () => {
      const [lib, bytes] = await Promise.all([loadPdfjs(), readBytes(path)]);
      const base = new URL("vendor/pdfjs/web/", document.baseURI).href;
      const doc = await lib.getDocument({
        data: new Uint8Array(bytes), cMapUrl: `${base}cmaps/`, standardFontDataUrl: `${base}standard_fonts/`,
        wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, isEvalSupported: false,
      }).promise;
      return { lib, doc };
    })());
    pdfOpen.get(path).catch(() => pdfOpen.delete(path));
  }
  return pdfOpen.get(path);
}

function pdfClose() {
  for (const opened of pdfOpen.values()) opened.then(({ doc }) => doc.destroy(), () => {});
  pdfOpen.clear();
}

async function pdfPageText(page) {
  const content = await page.getTextContent();
  return content.items.map((item) => (item.str || "") + (item.hasEOL ? "\n" : "")).join("").replace(/[ \t]+\n/g, "\n").trim();
}

async function pdfInspect(path, name, readBytes, { first, vision }) {
  const { lib, doc } = await pdfDocument(path, readBytes);
  const { from, to } = pdfRange(first, doc.numPages, doc.numPages, PDF_LIMITS.inspectPages);
  const imageOps = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageXObjectRepeat]);
  const pages = [];
  for (let n = from; n <= to; n++) {
    const page = await doc.getPage(n);
    const [text, ops] = await Promise.all([pdfPageText(page), page.getOperatorList()]);
    pages.push({ page: n, chars: text.length, images: ops.fnArray.filter((fn) => imageOps.has(fn)).length });
    page.cleanup();
  }
  return { result: pdfReport(name, doc.numPages, pages, vision), detail: `${name} · ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}` };
}

async function pdfText(path, name, readBytes, { first, last, cap }) {
  const { doc } = await pdfDocument(path, readBytes);
  const { from, to } = pdfRange(first, last || doc.numPages, doc.numPages, doc.numPages);
  const out = [];
  let used = 0;
  let done = from - 1;
  for (let n = from; n <= to; n++) {
    const page = await doc.getPage(n);
    const text = await pdfPageText(page);
    page.cleanup();
    if (used + text.length > cap && out.length) break;
    out.push(`--- Page ${n} ---\n${text.slice(0, cap) || "(no extractable text on this page)"}`);
    used += text.length;
    done = n;
  }
  const more = done < to ? `\n[Stopped at page ${done} of ${doc.numPages}: output limit. Continue from page ${done + 1}.]` : "";
  return { result: `${name}, pages ${from}-${done} of ${doc.numPages}:\n${out.join("\n\n")}${more}`, detail: `${name} · pages ${from}–${done}` };
}

async function pdfView(path, name, readBytes, { first, last }) {
  const { doc } = await pdfDocument(path, readBytes);
  const { from, to } = pdfRange(first, last, doc.numPages, PDF_LIMITS.viewPages);
  const images = [];
  for (let n = from; n <= to; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_LIMITS.viewEdge / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff"; // JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
    // "print" draws in one go; the default paces itself on animation frames, which never come while the window is in the background.
    await page.render({ canvasContext: context, canvas, viewport, intent: "print" }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.82));
    page.cleanup();
  }
  const asked = Math.floor(Number(last)) || from;
  const capped = asked > to && to < doc.numPages ? ` Only ${PDF_LIMITS.viewPages} pages fit in one call; continue from page ${to + 1}.` : "";
  return { result: `${name}: page${from === to ? ` ${from}` : `s ${from}-${to}`} of ${doc.numPages} attached as image${from === to ? "" : "s"}, in order.${capped}`, detail: `${name} · page${from === to ? ` ${from}` : `s ${from}–${to}`}`, images };
}

if (typeof module !== "undefined") {
  module.exports = { PDF_LIMITS, pdfPageKind, pdfReport, pdfRange };
  if (require.main === module) {
    const assert = require("node:assert/strict");
    assert.deepEqual([pdfPageKind(900, 0), pdfPageKind(900, 2), pdfPageKind(10, 1), pdfPageKind(0, 0), pdfPageKind(120, 0)], ["text", "text+images", "scanned", "blank", "text"]);
    const pages = [{ page: 1, chars: 900, images: 0 }, { page: 2, chars: 800, images: 0 }, { page: 3, chars: 0, images: 1 }, { page: 4, chars: 700, images: 3 }];
    const seen = pdfReport("a.pdf", 9, pages, true);
    assert.ok(seen.startsWith("a.pdf: 9 pages\nPages 1-2: text layer, no images; 1700 chars, 0 images\nPage 3: no text layer, page is an image (scan); 0 chars, 1 image\nPage 4: text layer with embedded images"), seen);
    assert.ok(seen.includes("[Examined pages 1-4 of 9.") && seen.includes("look at them with pdf_view"), seen);
    const blind = pdfReport("a.pdf", 4, pages, false);
    assert.ok(blind.includes("cannot view images") && !blind.includes("pdf_view") && !blind.includes("[Examined"), blind);
    assert.deepEqual(pdfRange(3, 99, 10, 4), { from: 3, to: 6 });
    assert.deepEqual(pdfRange(undefined, undefined, 10, 4), { from: 1, to: 1 });
    assert.deepEqual(pdfRange(50, 2, 10, 4), { from: 10, to: 10 });
    console.log("pdfctx ok");
  }
}
