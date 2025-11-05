// api/server.js
const path = require("path");
const express = require("express");
const compression = require("compression");

function normalize(fn) {
  if (!fn) return null;
  if (typeof fn === "function") return fn;
  if (typeof fn.default === "function") return fn.default;
  if (typeof fn.handler === "function") return fn.handler;
  return null;
}

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Mount API (re-use Vercel handlers if exist)
const uploadMod = normalize(require("./upload"));
const askMod = normalize(require("./ask"));

if (uploadMod) app.post("/api/upload", (req, res) => uploadMod(req, res));
else app.post("/api/upload", (_req, res) => res.status(501).json({ ok: false, error: "upload not implemented" }));

if (askMod) app.post("/api/ask", (req, res) => askMod(req, res));
else app.post("/api/ask", (_req, res) => res.status(501).json({ ok: false, error: "ask not implemented" }));

// Simple settings endpoint
app.get("/api/settings", (_req, res) => {
  res.json({
    model: process.env.WENKU_MODEL || "local",
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    ok: true,
  });
});

// Static FE
const pub = path.join(__dirname, "..", "public");
app.use("/", express.static(pub, { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(pub, "index.html")));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Wenku server on :${PORT}`));
