// api/server.js
// Wenku API server (CommonJS)
// - Statika z /public
// - /api/settings, /api/upload, /api/ask
// - /api/file/:id  → PDF streaming (R2 s Range; fallback na disk)
// - /healthz

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

// Handlery business logiky
const { handleSettings } = require("./settings");
const { uploadMulter, handleUpload } = require("./upload");
const { handleAsk } = require("./ask");

// Store + R2 utils pro streaming
const { getSession } = require("../lib/store");
const { HAVE_R2, headR2, getR2Stream } = require("./files");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- Statika ---
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// Root
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// --- API ---
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask", handleAsk);

// --- File streaming pro viewer (R2 Range + fallback na disk) ---
app.get("/api/file/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const s = getSession(id);
    if (!s) return res.status(404).json({ error: "Unknown document" });

    const mime = s.mime || "application/pdf";
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");

    // ---- R2 varianta ----
    if (HAVE_R2 && s.fileKey) {
      const range = req.headers.range; // např. "bytes=0-"
      if (range) {
        // Předáme range do R2 a pošleme 206 + Content-Range
        // (Head není nutný, ale necháme si ho pro případné validace)
        await headR2(s.fileKey).catch(() => null);
        const r = await getR2Stream(s.fileKey, range);
        res.statusCode = 206;
        if (r.contentRange) res.setHeader("Content-Range", r.contentRange);
        res.setHeader("Content-Length", String(r.size));
        return r.body.pipe(res);
      } else {
        const r = await getR2Stream(s.fileKey, undefined);
        res.setHeader("Content-Length", String(r.size));
        return r.body.pipe(res);
      }
    }

    // ---- Disk fallback (dev) ----
    if (s.filePath && fs.existsSync(s.filePath)) {
      const stat = fs.statSync(s.filePath);
      const total = stat.size;
      const range = req.headers.range;

      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m) {
          res.statusCode = 416;
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
        return fs.createReadStream(s.filePath, { start, end }).pipe(res);
      } else {
        res.setHeader("Content-Length", String(total));
        return fs.createReadStream(s.filePath).pipe(res);
      }
    }

    return res.status(404).json({ error: "File not found" });
  } catch (e) {
    console.error("file stream error", e);
    res.status(500).json({ error: "file stream failed" });
  }
});

// Health
app.get("/healthz", (_req, res) => res.send("ok"));

// --- START ---
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

(async function boot() {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
  });
})().catch(err => {
  console.error("Server boot failed:", err);
  process.exit(1);
});
