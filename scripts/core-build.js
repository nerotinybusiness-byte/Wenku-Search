// scripts/core-build.js (CommonJS)
// Vstup: public/core/*.pdf|*.docx|*.txt|*.md (kromě .json)
// Výstup: public/core/core-index.json + public/core/chunks/<slug>.json

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const { chunkPages } = require("../lib/chunker.js");
const { tokenize } = require("../lib/retriever.js");

const CORE_DIR = path.resolve(__dirname, "../public/core");
const CHUNKS_DIR = path.join(CORE_DIR, "chunks");
const INDEX_PATH = path.join(CORE_DIR, "core-index.json");

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
  while (i < text.length) {
    pages.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return pages.length ? pages : [text];
}

// pdf-parse: extrakce po stránkách
async function extractPdfByPages(buf) {
  const pages = [];
  const opt = {
    pagerender: (pageData) => pageData.getTextContent().then(tc => {
      const pageText = tc.items.map(it => it.str).join(" ");
      pages.push(pageText);
      return pageText;
    })
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

(async function main(){
  await fs.promises.mkdir(CORE_DIR, { recursive: true });
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
    const abs = path.join(CORE_DIR, name);
    const slug = toSlug(name);
    console.log(`→ Build: ${name} (${slug})`);
    const pages = await extractPagesFromFile(abs);

    const chunks = chunkPages(pages, { targetTokens: 1200, overlapChars: 200 })
      .map(ch => ({
        pageStart: ch.pageStart ?? 0,
        text: ch.text,
        terms: tokenize(ch.text)
      }));

    const out = { slug, name, pages: pages.length, chunks };
    const chunkPath = path.join(CHUNKS_DIR, `${slug}.json`);
    await fs.promises.writeFile(chunkPath, JSON.stringify(out), "utf8");

    docsOut.push({
      slug,
      name,
      pages: pages.length,
      sessionId: `core_${slug}`
    });
  }

  const version = new Date().toISOString().replace(/:/g, "-");
  await fs.promises.writeFile(INDEX_PATH, JSON.stringify({ version, docs: docsOut }, null, 2), "utf8");
  console.log(`OK • ${docsOut.length} dokument(ů), verze: ${version}`);
})().catch(err => {
  console.error("build:core selhal:", err);
  process.exit(1);
});
