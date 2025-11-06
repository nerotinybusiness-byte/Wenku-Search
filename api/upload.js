const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { ensureSession, putSession } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");

// helper: pokusí se převést latin1 → utf8 (řeší „ManuĂ¡l“ → „Manuál“)
function fixFilename(raw) {
  if (!raw) return "document";
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8");
    // když by konverze dala nesmysl, vrať původní
    return repaired.includes("�") ? raw : repaired;
  } catch {
    return raw;
  }
}

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(__dirname, "..", ".tmp")),
    filename: (_req, file, cb) => cb(null, Date.now() + "-" + (file.originalname || "file")),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function extractPagesFromBuffer(buf, ext) {
  let pageTexts = [];
  if (ext === ".pdf") {
    const data = await pdfParse(buf);
    const total = data.numpages || 1;
    if (total > 1) {
      const lines = (data.text || "").split(/\n/);
      const perPage = Math.ceil(lines.length / Math.max(total, 1));
      for (let i = 0; i < total; i++) {
        pageTexts.push(lines.slice(i * perPage, (i + 1) * perPage).join("\n").trim());
      }
    } else {
      pageTexts = [(data.text || "").trim()];
    }
  } else if (ext === ".docx") {
    const r = await mammoth.extractRawText({ buffer: buf });
    const text = (r.value || "").trim();
    const size = 1200;
    for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
    if (pageTexts.length === 0) pageTexts = [text];
  } else if (ext === ".txt" || ext === ".md") {
    const text = buf.toString("utf8");
    const size = 1500;
    for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
    if (pageTexts.length === 0) pageTexts = [text];
  } else {
    throw new Error(`Nepodporovaný typ: ${ext || "neznámý"}. Podporováno: PDF, DOCX, TXT, MD.`);
  }
  return pageTexts;
}

async function handleUpload(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Soubor chybí (field 'file')." });

    // ✅ oprava názvu na UTF-8
    const originalRaw = file.originalname || "document";
    const original = fixFilename(originalRaw);

    const ext = path.extname(original || file.filename || "").toLowerCase();
    const buf = fs.readFileSync(file.path);

    const pageTexts = await extractPagesFromBuffer(buf, ext);

    const session = ensureSession();
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    // ukládáme i název, aby se správně zobrazil a šel do citací
    putSession(session.id, { createdAt: Date.now(), name: original, pages: pageTexts, chunks });

    try { fs.unlinkSync(file.path); } catch {}

    res.json({
      sessionId: session.id,
      docId: session.id,
      name: original,       // ✅ správný UTF-8 název
      filename: original,   // pro kompatibilitu
      pages: pageTexts.length,
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Upload selhal." });
  }
}

module.exports = { uploadMulter, handleUpload };
