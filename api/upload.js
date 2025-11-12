// api/upload.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const { ensureSession, putSession, findSessionByFileHash } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");
const { saveOriginal } = require("./files");

function fixFilename(raw) {
  if (!raw) return "document";
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8");
    return repaired.includes("�") ? raw : repaired;
  } catch { return raw; }
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
      const perPage = Math.ceil(lines.length / total);
      for (let i = 0; i < total; i++) {
        pageTexts.push(lines.slice(i * perPage, (i + 1) * perPage).join("\n").trim());
      }
    } else pageTexts = [(data.text || "").trim()];
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
    throw new Error(`Nepodporovaný typ: ${ext || "neznámý"} (PDF, DOCX, TXT, MD).`);
  }
  return pageTexts;
}

async function handleUpload(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Soubor chybí (field 'file')." });

    const originalRaw = file.originalname || "document";
    const original = fixFilename(originalRaw);
    const ext = path.extname(original || file.filename || "").toLowerCase();

    const buf = fs.readFileSync(file.path);
    const fileHash = crypto.createHash("sha1").update(buf).digest("hex");

    // Dedupe – vrátíme existující session se stejným souborem
    const dup = findSessionByFileHash(fileHash);
    if (dup && dup.pages?.length) {
      try { fs.unlinkSync(file.path); } catch {}
      return res.json({
        sessionId: dup.id,
        docId: dup.id,
        name: dup.name || original,
        pages: dup.pages.length,
        duplicateOf: dup.id,
      });
    }

    // Extrakce textu
    const pageTexts = await extractPagesFromBuffer(buf, ext);
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    // Uložit originál do R2 (fallback disk) + metadata do session
    const session = ensureSession();
    const mime =
      file.mimetype ||
      (ext === ".pdf" ? "application/pdf" :
       ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
       ext === ".txt" ? "text/plain" :
       ext === ".md" ? "text/markdown" : "application/octet-stream");

    const saved = await saveOriginal(buf, {
      sessionId: session.id,
      ext,
      mime,
    });

    const safeName = sanitizeName(original);

    putSession(session.id, {
      id: session.id,
      createdAt: Date.now(),
      name: original,
      filename: safeName,
      fileHash,
      hasPdf: ext === ".pdf",
      mime,
      pages: pageTexts,
      chunks,
      // storage info
      filePath: saved.path || null,
      fileKey: saved.key || null,
      storage: saved.storage,
    });

    try { fs.unlinkSync(file.path); } catch {}

    res.json({
      sessionId: session.id,
      docId: session.id,
      name: original,
      pages: pageTexts.length,
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Upload selhal." });
  }
}

module.exports = { uploadMulter, handleUpload };
