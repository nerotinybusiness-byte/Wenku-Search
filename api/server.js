const http = require("http");
const path = require("path");
const express = require("express");
const compression = require("compression");

const { handleAsk } = require("./ask");
const { handleUpload, uploadMulter } = require("./upload");
const { handleSettings } = require("./settings");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

const fs = require("fs");
const tmpPath = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath);

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

// ⚙️ statika
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store, must-revalidate"); next(); });
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// --- API ---
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);
app.post("/api/ask", handleAsk);

app.get("/healthz", (_req, res) => res.send("ok"));

// --- START ---
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
});
