// api/server.js
const http = require("http");
const path = require("path");
const express = require("express");
const compression = require("compression");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// 🔧 STATIKA z ../public (protože server běží z /api)
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.set("etag", false);
app.use((req, res, next) => {
  // během ladění nechceme 7denní cache
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, maxAge: 0 }));

// 🔧 ROOT → index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --- API ---------------------------------------------------
app.get("/api/settings", (_req, res) => {
  res.json({
    ok: true,
    model: process.env.WENKU_MODEL || "local",
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  });
});

app.post("/api/upload", (_req, res) => {
  res.json({ sessionId: "demo", pages: 1 });
});

app.post("/api/ask", (_req, res) => {
  res.json({
    answer: "Mock odpověď (zatím bez reálného RAG).",
    citations: [{ page: 1, text: "Ukázková citace" }],
  });
});

app.get("/healthz", (_req, res) => res.send("ok"));

// --- START -------------------------------------------------
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku server listening on http://0.0.0.0:${PORT}`);
});
