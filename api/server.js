// api/server.js
const http = require("http");
const path = require("path");
const express = require("express");
const compression = require("compression");

const app = express();

// Základní nastavení
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- Healthcheck (Render / uptime pingi) -------------------
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// --- API ---------------------------------------------------
app.get("/api/settings", (_req, res) => {
  res.json({
    model: process.env.WENKU_MODEL || "local",
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ok: true,
  });
});

// Dočasné stuby ať ihned běží (později nahradíš reálnými handlery)
app.post("/api/upload", (_req, res) => {
  res.json({ sessionId: "demo", pages: 1 });
});

app.post("/api/ask", (_req, res) => {
  res.json({
    answer: "MVP běží. Připojíme reálné RAG až bude připraveno.",
    citations: [{ page: 1, excerpt: "Ukázkový výňatek." }],
  });
});

// --- Statika (FE) ------------------------------------------
const pub = path.join(__dirname, "..", "public");

// Statické soubory: CSS/JS s cachováním, HTML bez
app.use(
  "/",
  express.static(pub, {
    extensions: ["html"],
    etag: true,
    maxAge: "7d",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// Fallback na SPA/Index pro ostatní cesty
app.get("*", (_req, res) => {
  res.sendFile(path.join(pub, "index.html"));
});

// --- Server + time-outy pro Render --------------------------
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

// Render doporučení: delší keepAlive + headers timeout
server.keepAliveTimeout = 120 * 1000; // 120s
server.headersTimeout = 125 * 1000;   // musí být > keepAliveTimeout

// Jednoduchý error handler, ať proces nepadá na sync chybách
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Wenku running on http://0.0.0.0:${PORT}`);
});
