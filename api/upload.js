// api/upload.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const { ensureSession, putSession, findSessionByFileHash } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");
const { UPLOAD_DIR, ensureUploadsDir } = require("./files");

function sanitizeName(name) { return String(name || "document").replace(/[^\w.\-]+/g, "_").slice(0, 120); }
function fixFilenameLatin1(raw) { try { const s = Buffer.from(raw || "document", "latin1").toString("utf8"); return s.includes("�") ? raw : s; } catch { return raw || "document"; } }

const TMP_DIR  = path.join(__dirname, "..", ".tmp");
const META_DIR = path.join(__dirname, "..", "data", "docs");
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(META_DIR, { recursive: true }); } catch {}

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const rnd = crypto.randomBytes(6).toString("hex");
      cb(null, `${Date.now()}-${rnd}${ext || ".bin"}`); // **safe temp filename**
    }
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
      for (let i = 0; i < total; i++) pageTexts.push(lines.slice(i * perPage, (i + 1) * perPage).join("\n").trim());
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
    if (!file || !file.path) return res.status(400).json({ error: "Soubor chybí (field 'file')." });

    const original = fixFilenameLatin1(file.originalname || "document");
    const ext = path.extname(original || "").toLowerCase();

    if (!fs.existsSync(file.path)) {
      return res.status(500).json({ error: "Dočasný soubor nebyl nalezen." });
    }
    const buf = fs.readFileSync(file.path);

    const fileHash = crypto.createHash("sha1").update(buf).digest("hex");
    const dup = findSessionByFileHash(fileHash);
    if (dup && dup.pages?.length) {
      try { fs.unlinkSync(file.path); } catch {}
      return res.json({ sessionId: dup.id, docId: dup.id, name: dup.name || original, pages: dup.pages.length, duplicateOf: dup.id });
    }

    const pageTexts = await extractPagesFromBuffer(buf, ext);
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    ensureUploadsDir();
    const session = ensureSession();
    const safeBase = sanitizeName(original);
    const outPath = path.join(UPLOAD_DIR, `${session.id}${ext || ""}`);
    fs.writeFileSync(outPath, buf);

    const mime =
      file.mimetype ||
      (ext === ".pdf" ? "application/pdf" :
       ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
       ext === ".txt" ? "text/plain" :
       ext === ".md" ? "text/markdown" : "application/octet-stream");

    // store (RAM)
    putSession(session.id, {
      id: session.id, createdAt: Date.now(),
      name: original, filename: safeBase, filePath: outPath,
      fileHash, hasPdf: ext === ".pdf", mime,
      pages: pageTexts, chunks
    });

    // persist metadata (pro /api/file/by-doc a R2)
    const meta = {
      id: session.id, createdAt: Date.now(),
      name: original, mime, filePath: outPath, r2Key: null, pages: pageTexts.length
    };
    fs.writeFileSync(path.join(META_DIR, `${session.id}.json`), JSON.stringify(meta, null, 2));

    try { fs.unlinkSync(file.path); } catch {}

    res.json({ sessionId: session.id, docId: session.id, name: original, pages: pageTexts.length });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Upload selhal." });
  }
}

module.exports = { uploadMulter, handleUpload };
