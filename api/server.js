// api/server.js
// Minimal Wenku server: statika + settings + upload + doc/file (R2 presign) + inline viewer
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


// zajisti .tmp pro multer
const TMP_DIR = path.join(__dirname, "..", ".tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// zajisti metadata dir (pro jistotu i tady)
const META_DIR = path.join(__dirname, "..", "data", "docs");
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });


app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- zajistíme existenci pracovních adresářů ---
const ROOT_DIR   = path.join(__dirname, "..");
const TMP_DIR    = path.join(ROOT_DIR, ".tmp");
const DOCS_DIR   = path.join(ROOT_DIR, "data", "docs");
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(DOCS_DIR, { recursive: true }); } catch {}

// Statika
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
app.set("etag", false);
app.use((_, res, next) => { res.setHeader("Cache-Control", "no-store, must-revalidate"); next(); });
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// Root
app.get("/", (_, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// API
app.get("/api/settings", handleSettings);
app.post("/api/upload", uploadMulter.single("file"), handleUpload);

// Dokumenty (R2 + metadata)
app.get("/api/doc/:docId", DocAPI.getDoc);
app.get("/api/file/by-doc/:docId", DocAPI.fileByDoc);
app.delete("/api/doc/:docId", DocAPI.deleteDoc);

// Health
app.get("/healthz", (_, res) => res.send("ok"));

const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout   = 125000;

(function boot() {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Wenku listening on http://0.0.0.0:${PORT}`);
  });
})();
