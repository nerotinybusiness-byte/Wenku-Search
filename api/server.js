// api/server.js
// Wenku server: statika + settings + upload + doc/file (R2 presign) + inline viewer

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

// Handlery
const { handleSettings } = require("./settings");
const { uploadMulter, handleUpload } = require("./upload");
const DocAPI = require("./doc");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ---- Cesty (deklarovat JEDNOU) -------------------------------------------
const ROOT_DIR   = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR   = path.join(ROOT_DIR, "data");
const DOCS_DIR   = path.join(DATA_DIR, "docs");
const TMP_DIR    = path.join(ROOT_DIR, ".tmp"); // <— jediná deklarace

// Vytvoř chybějící složky
for (const p of [DATA_DIR, DOCS_DIR, TMP_DIR]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ---- Statika --------------------------------------------------------------
app.set("etag", false);
app.use((_, res, next) => {
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ---- API ------------------------------------------------------------------
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);

// Dokumenty (R2 + metadata)
app.get("/api/doc/:docId", DocAPI.getDoc);
app.get("/api/file/by-doc/:docId", DocAPI.fileByDoc);
app.delete("/api/doc/:docId", DocAPI.deleteDoc);

// Health
app.get("/healthz", (_, res) => res.send("ok"));

// ---- START ----------------------------------------------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout   = 125000;

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku listening on http://0.0.0.0:${PORT}`);
});
