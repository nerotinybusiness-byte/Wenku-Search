// api/upload.js
// Upload + extrakce textu z dokumentu (PDF, DOCX, TXT, MD) + chunkování do RAM

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const { ensureSession, putSession, findSessionByFileHash } = require("../lib/store");
const { chunkPages } = require("../lib/chunker");
const { UPLOAD_DIR, ensureUploadsDir } = require("./files");

/* -------- helpers na názvy souborů -------- */

function sanitizeName(name) {
  return String(name || "document")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function fixFilenameLatin1(raw) {
  try {
    const s = Buffer.from(raw || "document", "latin1").toString("utf8");
    return s.includes("�") ? raw : s;
  } catch {
    return raw || "document";
  }
}

/* -------- temp & meta složky -------- */

const TMP_DIR  = path.join(__dirname, "..", ".tmp");
const META_DIR = path.join(__dirname, "..", "data", "docs");

try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(META_DIR, { recursive: true }); } catch {}

/* -------- Multer (upload na disk) -------- */

const uploadMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const rnd = crypto.randomBytes(6).toString("hex");
      cb(null, `${Date.now()}-${rnd}${ext || ".bin"}`); // safe temp filename
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

/* ========================================================================== */
/*                          EXTRAKCE TEXTU Z DOKUMENTU                        */
/* ========================================================================== */

/**
 * Robustnější extrakce PDF:
 * - používá pdf-parse s pagerender → text po stránkách
 * - když něco selže, spadne na starý jednoduchý režim (data.text)
 */
async function extractPdfPages(buf) {
  const pages = [];

  try {
    const opt = {
      pagerender: (pageData) =>
        pageData.getTextContent().then(tc => {
          const pageText = tc.items.map(it => it.str).join(" ");
          pages.push(pageText);
          return pageText;
        })
    };

    await pdfParse(buf, opt);

    const norm = pages
      .map(t => (t || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (norm.length) return norm;
  } catch (e) {
    console.warn("[upload] pagerender PDF failed, fallback:", e?.message || e);
  }

  // Fallback – původní jednoduchý režim
  try {
    const data = await pdfParse(buf);
    const text = (data.text || "").trim();
    const total = data.numpages || 1;

    if (!text) return [""];

    if (total > 1) {
      const lines = text.split(/\n/);
      const perPage = Math.ceil(lines.length / Math.max(total, 1));
      const byPage = [];
      for (let i = 0; i < total; i++) {
        byPage.push(lines.slice(i * perPage, (i + 1) * perPage).join(" ").trim());
      }
      return byPage;
    }

    return [text];
  } catch (e) {
    console.error("[upload] pdf-parse total fallback failed:", e?.message || e);
    return [""];
  }
}

async function extractDocxPages(buf) {
  const r = await mammoth.extractRawText({ buffer: buf });
  const text = (r.value || "").trim();
  if (!text) return [""];

  const size = 1200; // cca pseudo-stránky
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out.length ? out : [text];
}

async function extractTxtPages(buf) {
  const text = buf.toString("utf8");
  if (!text) return [""];

  const size = 1500;
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out.length ? out : [text];
}

/**
 * Jednotný wrapper podle přípony
 */
async function extractPagesFromBuffer(buf, ext) {
  ext = (ext || "").toLowerCase();

  if (ext === ".pdf")  return extractPdfPages(buf);
  if (ext === ".docx") return extractDocxPages(buf);
  if (ext === ".txt" || ext === ".md") return extractTxtPages(buf);

  throw new Error(`Nepodporovaný typ: ${ext || "neznámý"} (PDF, DOCX, TXT, MD).`);
}

/* ========================================================================== */
/*                               MAIN HANDLER                                 */
/* ========================================================================== */

async function handleUpload(req, res) {
  try {
    const file = req.file;
    if (!file || !file.path) {
      return res.status(400).json({ error: "Soubor chybí (field 'file')." });
    }

    const original = fixFilenameLatin1(file.originalname || "document");
    const ext = path.extname(original || "").toLowerCase();

    if (!fs.existsSync(file.path)) {
      return res.status(500).json({ error: "Dočasný soubor nebyl nalezen." });
    }

    const buf = fs.readFileSync(file.path);

    // deduplikace podle SHA1 obsahu
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

    // → stránky (už robustnější PDF extrakce)
    const pageTexts = await extractPagesFromBuffer(buf, ext);

    // → chunky pro RAG
    const { chunks } = chunkPages(pageTexts, {
      targetTokens: 1200,
      overlapChars: 200
    });

    // → uložit originál (disk / R2)
    ensureUploadsDir();
    const session = ensureSession();
    const safeBase = sanitizeName(original);
    const outPath = path.join(UPLOAD_DIR, `${session.id}${ext || ""}`);
    fs.writeFileSync(outPath, buf);

    // MIME type
    const mime =
      file.mimetype ||
      (ext === ".pdf"  ? "application/pdf" :
       ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
       ext === ".txt"  ? "text/plain" :
       ext === ".md"   ? "text/markdown" :
                         "application/octet-stream");

    // RAM store pro RAG
    putSession(session.id, {
      id: session.id,
      createdAt: Date.now(),
      name: original,
      filename: safeBase,
      filePath: outPath,
      fileHash,
      hasPdf: ext === ".pdf",
      mime,
      pages: pageTexts,
      chunks
    });

    // persist meta (pro /api/file/by-doc & R2)
    const meta = {
      id: session.id,
      createdAt: Date.now(),
      name: original,
      mime,
      filePath: outPath,
      r2Key: null,
      pages: pageTexts.length
    };
    fs.writeFileSync(
      path.join(META_DIR, `${session.id}.json`),
      JSON.stringify(meta, null, 2)
    );

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
