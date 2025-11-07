// api/core.js
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { getSession, putSession } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");

const CORE_DIR = path.join(__dirname, "..", "public", "core");
const MANIFEST = path.join(CORE_DIR, "manifest.json");

function safeIdFromName(name) {
  return "core_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

async function extractPagesFromBuffer(buf, ext) {
  let pageTexts = [];
  if (ext === ".pdf") {
    const data = await pdfParse(buf);
    const total = data.numpages || 1;
    if (total > 1) {
      const lines = data.text.split(/\n/);
      const perPage = Math.ceil(lines.length / total);
      for (let i = 0; i < total; i++) {
        pageTexts.push(lines.slice(i * perPage, (i + 1) * perPage).join("\n").trim());
      }
    } else {
      pageTexts = [data.text.trim()];
    }
  } else if (ext === ".docx") {
    const r = await mammoth.extractRawText({ buffer: buf });
    const text = (r.value || "").trim();
    const size = 1200;
    for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
    if (!pageTexts.length) pageTexts = [text];
  } else if (ext === ".txt" || ext === ".md") {
    const text = buf.toString("utf8");
    const size = 1500;
    for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
    if (!pageTexts.length) pageTexts = [text];
  } else {
    throw new Error(`Nepodporovaný typ: ${ext}`);
  }
  return pageTexts;
}

function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST, "utf8");
    const j = JSON.parse(raw);
    if (Array.isArray(j.files)) return j.files;
  } catch {}
  // fallback: prohledej složku
  try {
    return fs
      .readdirSync(CORE_DIR)
      .filter(n => /\.(pdf|docx|txt|md)$/i.test(n));
  } catch {
    return [];
  }
}

async function ensureCoreSessionForFile(filename) {
  const filePath = path.join(CORE_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const sid = safeIdFromName(filename);

  // už existuje?
  const maybe = getSession(sid);
  if (maybe?.pages?.length) {
    return { id: sid, name: filename, pages: maybe.pages.length, href: `/core/${filename}` };
  }

  const buf = fs.readFileSync(filePath);
  const pages = await extractPagesFromBuffer(buf, ext);
  const { chunks } = chunkPages(pages, { targetTokens: 1200, overlapChars: 200 });

  // ulož jako stabilní session
  putSession(sid, { id: sid, createdAt: Date.now(), pages, chunks, core: true, name: filename });

  return { id: sid, name: filename, pages: pages.length, href: `/core/${filename}` };
}

async function handleCore(_req, res) {
  try {
    const filenames = readManifest();
    if (!filenames.length) return res.json({ files: [] });

    const out = [];
    for (const fname of filenames) {
      try {
        out.push(await ensureCoreSessionForFile(fname));
      } catch (e) {
        console.warn("[core] failed", fname, e?.message || e);
      }
    }
    res.json({ files: out });
  } catch (e) {
    console.error("CORE ERROR:", e);
    res.status(500).json({ error: "core failed" });
  }
}

module.exports = { handleCore };
