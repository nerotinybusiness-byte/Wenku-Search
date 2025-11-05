// api/server.js
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

// ⚙️ statika
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// root
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
