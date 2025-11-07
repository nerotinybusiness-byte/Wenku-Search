// api/server.js
const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

const { handleAsk } = require("./ask");
const { handleUpload, uploadMulter } = require("./upload");
const { handleSettings } = require("./settings");
const { handleCore } = require("./core");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- TMP dir (multer) -----------------------------------------------------
const tmpPath = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });

// --- CORE files dir -------------------------------------------------------
const CORE_DIR = path.join(__dirname, "..", "core");
if (!fs.existsSync(CORE_DIR)) fs.mkdirSync(CORE_DIR, { recursive: true });

// --- Helpers --------------------------------------------------------------
function makeEtag(stat) {
  // jednoduchý silný ETag (není kryptografický hash, ale stačí pro revalidaci)
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
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// Root
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// Core
app.get("/api/core", handleCore);


// --- API (settings/upload/ask) -------------------------------------------
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask", handleAsk);

// --- CORE manifest --------------------------------------------------------
app.get("/api/core-manifest", (_req, res) => {
  try {
    const files = fs.readdirSync(CORE_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
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

// --- CORE file streaming s Accept-Ranges ----------------------------------
app.get("/api/file/:id", (req, res) => {
  try {
    const id = req.params.id;
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
    // hledáme soubor {id}.pdf v CORE_DIR
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
        res.statusCode = 416; // Range Not Satisfiable
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.end();
      }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
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

// --- START ---------------------------------------------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
});
