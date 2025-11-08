// api/server.js
// Wenku API server (CommonJS)
//
// - Statika z /public
// - Upload/Ask/Settings
// - Core Pack B bootstrap: načtení core-indexu + chunks do RAM
// - /api/core/list  → { version, docs:[{slug,name,pages,sessionId}] }
// - /api/core-manifest → pro SW prefetch (PDF streamy)
// - /api/file/:id → PDF stream (Range) podle sessionId NEBO slug-u

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

// Business endpoints
const { handleAsk } = require("./ask");
const { handleUpload, uploadMulter } = require("./upload");
const { handleSettings } = require("./settings");

// In-memory store
const { getSession, putSession } = require("../lib/store");

// ---------- Konstanty a cesty ----------
const PUBLIC_DIR      = path.join(__dirname, "..", "public");
const CORE_DIR        = path.join(PUBLIC_DIR, "core");
const CORE_CHUNKS_DIR = path.join(CORE_DIR, "chunks");
const CORE_INDEX_PATH = path.join(CORE_DIR, "core-index.json");

// ---------- Helpery ----------
function makeEtag(stat) {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}
function setLongCache(res) {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}
function toSlugBase(name) {
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}
function findCoreBySlug(slug) {
  try {
    const files = fs.readdirSync(CORE_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
    for (const f of files) if (toSlugBase(f) === slug) return path.join(CORE_DIR, f);
  } catch {}
  return null;
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// TMP pro multer
const tmpPath = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });

// ---------- Debug: list modelů ----------
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

// ---------- Statika ----------
app.set("etag", false);
app.use((_, res, next) => { res.setHeader("Cache-Control", "no-store, must-revalidate"); next(); });
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ---------- API ----------
app.get ("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask",    handleAsk);

// ---------- Core Pack B: registrace + seznam ----------
function registerCoreSessions() {
  if (!fs.existsSync(CORE_INDEX_PATH)) {
    console.warn("[core] core-index.json nenalezen – Core Pack B nebude aktivní.");
    return { version: null, docs: [] };
  }
  const index = JSON.parse(fs.readFileSync(CORE_INDEX_PATH, "utf8"));
  const docs  = Array.isArray(index.docs) ? index.docs : [];

  let loaded = 0;
  for (const d of docs) {
    try {
      const chunksPath = path.join(CORE_CHUNKS_DIR, `${d.slug}.json`);
      if (!fs.existsSync(chunksPath)) { console.warn("[core] chybí chunks:", d.slug); continue; }
      const parsed = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
      putSession(d.sessionId, {
        id: d.sessionId,
        createdAt: Date.now(),
        name: d.name,
        // core držíme lehké: stránky nepotřebujeme, pickExcerpts padne na chunk.text
        pages: new Array(parsed.pages || 0).fill(""),
        chunks: parsed.chunks || []
      });
      loaded++;
    } catch (e) {
      console.warn("[core] load fail", d.slug, e?.message || e);
    }
  }
  console.log(`[core] Načteno ${loaded}/${docs.length} core dokumentů (v${index.version})`);
  return { version: index.version, docs };
}

const coreCache = { version: null, docs: [] };
app.get("/api/core/list", (_req, res) => res.json({ version: coreCache.version, docs: coreCache.docs }));

// ---------- Core manifest pro SW ----------
app.get("/api/core-manifest", (_req, res) => {
  try {
    if (!fs.existsSync(CORE_DIR)) return res.json({ version: 1, items: [] });
    const files = fs.readdirSync(CORE_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
    const items = files.map(f => {
      const full = path.join(CORE_DIR, f);
      const stat = fs.statSync(full);
      return {
        id: toSlugBase(f),               // SLUG (ASCII) – stabilní
        title: f,                        // původní název pro UI
        size: stat.size,
        etag: makeEtag(stat),
        updatedAt: stat.mtimeMs,
        url: `/api/file/${encodeURIComponent(toSlugBase(f))}`, // PDF stream
        mime: "application/pdf",
      };
    });
    res.json({ version: 1, items });
  } catch (e) {
    console.error("CORE manifest error:", e);
    res.status(500).json({ error: "core-manifest failed" });
  }
});

// ---------- PDF stream (preview) ----------
app.get("/api/file/:id", (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.id || "");
    let filePath = null;

    // 1) pokud je to sessionId (user/core upload se session.filePath)
    const s = getSession(raw);
    if (s?.filePath && fs.existsSync(s.filePath)) filePath = s.filePath;

    // 2) fallback: slug -> core PDF ve /public/core
    if (!filePath) filePath = findCoreBySlug(raw.replace(/^core_/, ""));

    if (!filePath) return res.status(404).json({ error: "File not found" });

    const stat = fs.statSync(filePath);
    const etag = makeEtag(stat);
    const lm   = new Date(stat.mtimeMs).toUTCString();

    if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", lm);
    setLongCache(res);

    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${total}`); return res.end(); }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end   = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= total) {
        res.statusCode = 416; res.setHeader("Content-Range", `bytes */${total}`); return res.end();
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.setHeader("Content-Length", String(total));
    return fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error("CORE file error:", e);
    res.status(500).json({ error: "file stream failed" });
  }
});

// ---------- Health ----------
app.get("/healthz", (_req, res) => res.send("ok"));

// ---------- Start ----------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout   = 125000;

(async function boot() {
  if (!fs.existsSync(CORE_DIR)) fs.mkdirSync(CORE_DIR, { recursive: true });
  if (!fs.existsSync(CORE_CHUNKS_DIR)) fs.mkdirSync(CORE_CHUNKS_DIR, { recursive: true });

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
