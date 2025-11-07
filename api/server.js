// api/server.js
// Wenku API server (CommonJS)
// - Statika z /public
// - Upload/Ask/Settings
// - Core Pack B:
//    * build-time JSON (public/core/core-index.json + chunks/*.json)
//    * registrace core sessions do RAM při startu
//    * GET /api/core/list  → { version, docs:[{slug,name,pages,sessionId}] }
// - Core streaming (pro viewer): /api/file/:id (PDF, Range) + /api/core-manifest (pro SW prefetch)

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

// Business endpoints
const { handleAsk } = require("./ask");
const { handleUpload, uploadMulter } = require("./upload");
const { handleSettings } = require("./settings");

// In-memory store (pro core sessions)
const { putSession } = require("../lib/store");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- TMP dir (multer) -----------------------------------------------------
const tmpPath = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });

// --- Cesty (sjednocené) ---------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const CORE_DIR   = path.join(PUBLIC_DIR, "core");             // << sjednoceno: core je pod /public/core
const CORE_CHUNKS_DIR = path.join(CORE_DIR, "chunks");        // build výstupy
const CORE_INDEX_PATH = path.join(CORE_DIR, "core-index.json");

// --- Helpery (ETag, cache) -----------------------------------------------
function makeEtag(stat) {
  // jednoduchý silný ETag (ne kryptografický hash)
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}
function setLongCache(res) {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}

// --- Models debug (Gemini ListModels) ------------------------------------
app.get("/api/models", async (_req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(400).json({ error: "GEMINI_API_KEY missing" });
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    console.error("ListModels error:", e);
    res.status(500).json({ error: "ListModels failed" });
  }
});

// --- Statika (public) -----------------------------------------------------
app.set("etag", false);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// Root
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// --- API (settings/upload/ask) -------------------------------------------
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask", handleAsk);

// --- Core Pack B: registrace + seznam ------------------------------------
/**
 * Načte build-time index + chunky a zaregistruje core sessions do RAM.
 * Vrací { version, docs }
 */
function registerCoreSessions() {
  if (!fs.existsSync(CORE_INDEX_PATH)) {
    console.warn("[core] core-index.json nenalezen – Core Pack B nebude aktivní.");
    return { version: null, docs: [] };
  }
  const idxRaw = fs.readFileSync(CORE_INDEX_PATH, "utf8");
  const index = JSON.parse(idxRaw);
  const docs = Array.isArray(index.docs) ? index.docs : [];

  let loaded = 0;
  for (const d of docs) {
    const chunksPath = path.join(CORE_CHUNKS_DIR, `${d.slug}.json`);
    if (!fs.existsSync(chunksPath)) {
      console.warn(`[core] chybí chunks: ${d.slug} – přeskočeno`);
      continue;
    }
    const cRaw = fs.readFileSync(chunksPath, "utf8");
    const parsed = JSON.parse(cRaw);

    // Zapiš session do RAM (bez per-page textu; pickExcerpts umí fallback na chunk.text)
    putSession(d.sessionId, {
      id: d.sessionId,
      createdAt: Date.now(),
      name: d.name,
      pages: new Array(parsed.pages).fill(""),
      chunks: parsed.chunks
    });
    loaded++;
  }
  console.log(`[core] Načteno ${loaded}/${docs.length} core dokumentů (v${index.version})`);
  return { version: index.version, docs };
}

// cache pro GET /api/core/list
const coreCache = { version: null, docs: [] };
app.get("/api/core/list", (_req, res) => {
  res.json({ version: coreCache.version, docs: coreCache.docs });
});

// --- Core manifest (pro SW prefetch streamů) ------------------------------
app.get("/api/core-manifest", (_req, res) => {
  try {
    if (!fs.existsSync(CORE_DIR)) return res.json({ version: 1, items: [] });
    const files = fs
      .readdirSync(CORE_DIR)
      .filter(f => f.toLowerCase().endsWith(".pdf"));

    const items = files.map(f => {
      const full = path.join(CORE_DIR, f);
      const stat = fs.statSync(full);
      const id = path.basename(f, path.extname(f));
      return {
        id,
        title: f,
        size: stat.size,
        etag: makeEtag(stat),
        updatedAt: stat.mtimeMs,
        url: `/api/file/${encodeURIComponent(id)}`, // stream s Range
        mime: "application/pdf",
      };
    });
    res.json({ version: 1, items });
  } catch (e) {
    console.error("CORE manifest error:", e);
    res.status(500).json({ error: "core-manifest failed" });
  }
});

// --- Core file streaming s Accept-Ranges ----------------------------------
app.get("/api/file/:id", (req, res) => {
  try {
    const id = req.params.id;
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = path.join(CORE_DIR, `${safe}.pdf`);
    if (!filePath.startsWith(CORE_DIR)) return res.status(400).end(); // ochrana
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

    const stat = fs.statSync(filePath);
    const etag = makeEtag(stat);
    const lm = new Date(stat.mtimeMs).toUTCString();

    // ETag revalidace
    if (req.headers["if-none-match"] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", lm);
    setLongCache(res);

    const range = req.headers.range;
    const total = stat.size;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.end();
      }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end   = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= total) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", (e) => { console.error("core stream error", e); res.destroy(e); });
      return stream.pipe(res);
    } else {
      res.setHeader("Content-Length", String(total));
      const stream = fs.createReadStream(filePath);
      stream.on("error", (e) => { console.error("core stream error", e); res.destroy(e); });
      return stream.pipe(res);
    }
  } catch (e) {
    console.error("CORE file error:", e);
    res.status(500).json({ error: "file stream failed" });
  }
});

// Health
app.get("/healthz", (_req, res) => res.send("ok"));

// --- START (nejdřív core registrace, pak listen) --------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout   = 125000;

(async function boot() {
  // vytvoř strukturu /public/core (pro jistotu)
  if (!fs.existsSync(CORE_DIR)) fs.mkdirSync(CORE_DIR, { recursive: true });
  if (!fs.existsSync(CORE_CHUNKS_DIR)) fs.mkdirSync(CORE_CHUNKS_DIR, { recursive: true });

  // Core Pack B: registrace do RAM
  const { version, docs } = registerCoreSessions();
  coreCache.version = version;
  coreCache.docs    = docs;

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
  });
})().catch(err => {
  console.error("Server boot selhal:", err);
  process.exit(1);
});
