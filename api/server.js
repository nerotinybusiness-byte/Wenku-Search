// api/server.js
// Wenku — minimal server bez Core Packu
const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

const { handleAsk } = require("./ask");
const { handleUpload, uploadMulter } = require("./upload");
const { handleSettings } = require("./settings");
const { getSession } = require("../lib/store");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- TMP dir pro multer ---------------------------------------------------
const tmpPath = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });

// --- Statika --------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((_, res, next) => { res.setHeader("Cache-Control", "no-store, must-revalidate"); next(); });
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// --- API ------------------------------------------------------------------
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask", handleAsk);

// --- Jediný PDF preview endpoint: /api/file/:sessionId -------------------
function makeEtag(stat) {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}
function setLongCache(res) {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}

app.get("/api/file/:sessionId", (req, res) => {
  try {
    const sid = String(req.params.sessionId || "");
    const s = getSession(sid);
    if (!s || !s.filePath || !fs.existsSync(s.filePath)) {
      return res.status(404).json({ error: "Soubor nenalezen. Nahraj znovu." });
    }

    const stat = fs.statSync(s.filePath);
    const etag = makeEtag(stat);
    const lm = new Date(stat.mtimeMs).toUTCString();

    if (req.headers["if-none-match"] === etag) {
      res.statusCode = 304; return res.end();
    }

    const mime = s.mime || "application/pdf";
    res.setHeader("Content-Type", mime);
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
      return fs.createReadStream(s.filePath, { start, end }).pipe(res);
    } else {
      res.setHeader("Content-Length", String(total));
      return fs.createReadStream(s.filePath).pipe(res);
    }
  } catch (e) {
    console.error("FILE STREAM ERROR:", e);
    res.status(500).json({ error: "file stream failed" });
  }
});

// --- Health ---------------------------------------------------------------
app.get("/healthz", (_req, res) => res.send("ok"));

// --- START ---------------------------------------------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
});
