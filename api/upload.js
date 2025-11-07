const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { ensureSession, putSession } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");
const { UPLOAD_DIR, ensureUploadsDir } = require("./files"); // 🆕 persist originál

// helper: pokusí se převést latin1 → utf8 (řeší „ManuĂ¡l“ → „Manuál“)
function fixFilename(raw) {
  if (!raw) return "document";
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8");
    return repaired.includes("�") ? raw : repaired;
  } catch {
    return raw;
  }
}
function sanitizeName(name) {
  return String(name || "document").replace(/[^\w.\-]+/g, "_").slice(0, 120);
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

    // načti do bufferu (z .tmp)
    const buf = fs.readFileSync(file.path);

    // textová extrakce → stránky
    const pageTexts = await extractPagesFromBuffer(buf, ext);

    // session + chunking
    const session = ensureSession();
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    // 🆕 ulož originál do /uploads + metadata do session (pro viewer)
    try {
      ensureUploadsDir();
      const safeName = sanitizeName(original);
      const outPath = path.join(UPLOAD_DIR, `${session.id}${ext || ''}`);
      fs.writeFileSync(outPath, buf);
      const mime =
        file.mimetype ||
        (ext === ".pdf" ? "application/pdf" :
         ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
         ext === ".txt" ? "text/plain" :
         ext === ".md" ? "text/markdown" : "application/octet-stream");

      // ulož vše do store (zachovej stávající shape)
      putSession(session.id, {
        createdAt: Date.now(),
        name: original,
        filename: safeName,
        filePath: outPath,
        mime,
        pages: pageTexts,
        chunks
      });
    } catch (e) {
      console.warn("[upload] persist original failed:", e?.message || e);
      // i kdyby persist selhal, session s textem a chunky zůstává
      putSession(session.id, { createdAt: Date.now(), name: original, pages: pageTexts, chunks });
    }

    // uklid dočasného souboru
    try { fs.unlinkSync(file.path); } catch {}

    res.json({
      sessionId: session.id,
      docId: session.id,
      name: original,       // ✅ správný UTF-8 název
      filename: original,   // kompatibilita
      pages: pageTexts.length,
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Upload selhal." });
  }
}

module.exports = { uploadMulter, handleUpload };
