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

// --- API ---------------------------------------------------
app.get("/api/settings", (_req, res) => {
  res.json({
    model: process.env.WENKU_MODEL || "local",
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ok: true,
  });
});
app.post("/api/upload", (_req, res) => res.json({ sessionId: "demo", pages: 1 }));
app.post("/api/ask", (_req, res) =>
  res.json({ answer: "MVP běží.", citations: [{ page: 1, excerpt: "Ukázka." }] })
);

// --- Statika ----------------------------------------------
const pub = path.join(__dirname, "..", "public");
app.use("/", express.static(pub, { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(pub, "index.html")));

// --- Server + time-outy pro Render -------------------------
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

// Render doporučení: delší keepAlive + headers timeout
server.keepAliveTimeout = 120 * 1000;   // 120s
server.headersTimeout   = 125 * 1000;   // musí být > keepAliveTimeout

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku running on http://0.0.0.0:${PORT}`);
});
