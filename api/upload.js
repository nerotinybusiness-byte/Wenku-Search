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

// --- utily ---
function sanitizeName(name) {
  return String(name || "document").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}
function fixFilenameLatin1(raw) {
  if (!raw) return "document";
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8");
    return repaired.includes("�") ? raw : repaired;
  } catch { return raw; }
}

// --- temp složka pro multer (musí existovat!) ---
const TMP_DIR = path.join(__dirname, "..", ".tmp");
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// Ukládáme do .tmp pod „safe“ názvem (bez diakritiky); originální jméno držíme v metadatech
const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const rnd = crypto.randomBytes(6).toString("hex");
      cb(null, `${Date.now()}-${rnd}${ext || ".bin"}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// --- parsování na stránky ---
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

// --- hlavní handler uploadu ---
async function handleUpload(req, res) {
  try {
    const file = req.file;
    if (!file || !file.path) return res.status(400).json({ error: "Soubor chybí (field 'file')." });

    // originální jméno (UTF-8 opravíme jen pro zobrazení)
    const original = fixFilenameLatin1(file.originalname || "document");
    const ext = path.extname(original || "").toLowerCase();

    // načíst z .tmp (ochrana na případ, že soubor mezitím neexistuje)
    if (!fs.existsSync(file.path)) {
      return res.status(500).json({ error: "Dočasný soubor nebyl nalezen." });
    }
    const buf = fs.readFileSync(file.path);

    // deduplikace
    const fileHash = crypto.createHash("sha1").update(buf).digest("hex");
    const dup = findSessionByFileHash(fileHash);
    if (dup && dup.pages?.length) {
      try { fs.unlinkSync(file.path); } catch {}
      return res.json({
        sessionId: dup.id,
        docId: dup.id,
        name: dup.name || original,
        pages: dup.pages.length,
        duplicateOf: dup.id
      });
    }

    // extrakce textu -> chunky
    const pageTexts = await extractPagesFromBuffer(buf, ext);
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    // persist originál (pro viewer/R2 část už máš ve svém r2.js/doc.js)
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

    putSession(session.id, {
      id: session.id,
      createdAt: Date.now(),
      name: original,         // zobrazované jméno
      filename: safeBase,     // safe base name
      filePath: outPath,      // lokální kopie (pro případný fallback)
      fileHash,
      hasPdf: ext === ".pdf",
      mime,
      pages: pageTexts,
      chunks
    });

    // uklid dočasného souboru
    try { fs.unlinkSync(file.path); } catch {}

    res.json({
      sessionId: session.id,
      docId: session.id,
      name: original,
      pages: pageTexts.length
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    res.status(500).json({ error: "Upload selhal." });
  }
}

module.exports = { uploadMulter, handleUpload };
