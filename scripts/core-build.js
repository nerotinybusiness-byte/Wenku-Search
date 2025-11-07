// scripts/core-build.js (CommonJS, robustní)
// - funguje s chunkerem, který vrací pole i {chunks: [...]}
// - přijímá overlap i overlapChars
// - má fallback chunkování (když chunker nic nevrátí)
// - výstup: public/core/core-index.json + public/core/chunks/<slug>.json

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");

// chunker může exportovat různě; zkuste načíst named i default
let chunkPages;
try {
  ({ chunkPages } = require("../lib/chunker.js"));
} catch {
  try { chunkPages = require("../lib/chunker.js"); } catch {}
}
const { tokenize } = require("../lib/retriever.js");

const CORE_DIR      = path.resolve(__dirname, "../public/core");
const CHUNKS_DIR    = path.join(CORE_DIR, "chunks");
const INDEX_PATH    = path.join(CORE_DIR, "core-index.json");

// ---------- helpers ----------
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function splitFixed(text, maxLen = 2000) {
  const pages = [];
  let i = 0;
  while (i < text.length) { pages.push(text.slice(i, i + maxLen)); i += maxLen; }
  return pages.length ? pages : [text];
}

// ---------- extractors ----------
async function extractPdfByPages(buf) {
  const pages = [];
  const opt = {
    pagerender: (pageData) =>
      pageData.getTextContent().then(tc => {
        const pageText = tc.items.map(it => it.str).join(" ");
        pages.push(pageText);
        return pageText;
      }),
  };
  await pdf(buf, opt);
  return pages;
}
async function extractDocx(buf) {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return splitFixed(value || "");
}
async function extractTxt(buf) {
  const value = buf.toString("utf8");
  return splitFixed(value || "");
}
async function extractPagesFromFile(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const buf = await fs.promises.readFile(absPath);
  if (ext === ".pdf")  return extractPdfByPages(buf);
  if (ext === ".docx") return extractDocx(buf);
  if (ext === ".txt" || ext === ".md") return extractTxt(buf);
  throw new Error(`Nepodporovaný typ souboru: ${ext}`);
}

// ---------- safe chunking ----------
function simpleFallbackChunks(pages, { windowChars = 1800, overlapChars = 200 } = {}) {
  const out = [];
  for (let p = 0; p < pages.length; p++) {
    const t = pages[p] || "";
    if (!t) continue;
    if (t.length <= windowChars) {
      out.push({ pageStart: p, text: t, terms: tokenize(t) });
      continue;
    }
    let i = 0;
    while (i < t.length) {
      const slice = t.slice(i, i + windowChars);
      out.push({ pageStart: p, text: slice, terms: tokenize(slice) });
      i += windowChars - overlapChars;
      if (i < 0) break;
    }
  }
  return out;
}

async function buildOne(absPath, name) {
  const slug = toSlug(name);
  console.log(`→ Build: ${name} (${slug})`);
  const pages = await extractPagesFromFile(absPath);

  let chunksRaw = [];
  // zavolej chunker, pokud existuje
  if (typeof chunkPages === "function") {
    // předáme oba klíče overlap(i) pro kompatibilitu
    const maybe = chunkPages(pages, { targetTokens: 1200, overlap: 200, overlapChars: 200 });
    // await je bezpečný i pro sync návrat
    const resolved = await Promise.resolve(maybe);
    chunksRaw = Array.isArray(resolved) ? resolved
               : (resolved && Array.isArray(resolved.chunks)) ? resolved.chunks
               : [];
  }

  // fallback: žádný chunker nebo nic nevrátil → jednoduché okno
  if (!Array.isArray(chunksRaw) || chunksRaw.length === 0) {
    chunksRaw = simpleFallbackChunks(pages, { windowChars: 1800, overlapChars: 200 });
  }

  // normalizace tvaru
  const chunks = chunksRaw.map(ch => ({
    pageStart: typeof ch.pageStart === "number" ? ch.pageStart : (ch.page ?? 0),
    text: String(ch.text ?? ""),
    terms: Array.isArray(ch.terms) && ch.terms.length ? ch.terms : tokenize(String(ch.text ?? "")),
  }));

  const out = { slug, name, pages: pages.length, chunks };
  const chunkPath = path.join(CHUNKS_DIR, `${slug}.json`);
  await fs.promises.writeFile(chunkPath, JSON.stringify(out), "utf8");

  return { slug, name, pages: pages.length, sessionId: `core_${slug}` };
}

(async function main(){
  await fs.promises.mkdir(CORE_DIR,   { recursive: true });
  await fs.promises.mkdir(CHUNKS_DIR, { recursive: true });

  const entries = await fs.promises.readdir(CORE_DIR, { withFileTypes: true });
  const inputs = entries
    .filter(d =>
      d.isFile() &&
      !/core-index\.json$/i.test(d.name) &&
      !/\.json$/i.test(d.name) &&
      !/^\./.test(d.name)
    )
    .map(d => d.name)
    .filter(n => /\.(pdf|docx|txt|md)$/i.test(n));

  const docsOut = [];
  for (const name of inputs) {
    try {
      const abs = path.join(CORE_DIR, name);
      const meta = await buildOne(abs, name);
      docsOut.push(meta);
    } catch (err) {
      console.warn(`! Přeskočeno ${name}:`, err.message || err);
    }
  }

  const version = new Date().toISOString().replace(/:/g, "-");
  await fs.promises.writeFile(INDEX_PATH, JSON.stringify({ version, docs: docsOut }, null, 2), "utf8");
  console.log(`OK • ${docsOut.length} dokument(ů), verze: ${version}`);
})().catch(err => {
  console.error("build:core selhal:", err);
  process.exit(1);
});
