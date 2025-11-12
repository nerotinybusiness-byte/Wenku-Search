const path = require("path");
const express = require("express");
const app = express();

/* ========= basics ========= */
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ========= static ========= */
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));

/* ========= settings ========= */
const settings = require("./settings");
if (typeof settings.handler === "function") {
  app.get("/api/settings", settings.handler);
} else {
  app.get("/api/settings", (_req, res) => {
    res.json({
      model: process.env.WENKU_MODEL || "local",
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY)
    });
  });
}

/* ========= upload & docs ========= */
const upload = require("./upload");
app.post("/api/upload", (req, res, next) =>
  (upload.handler ? upload.handler(req, res, next) : res.status(501).json({ error: "UPLOAD_NOT_IMPLEMENTED" }))
);

const doc = require("./doc");
app.get("/api/doc/:docId", (req, res, next) =>
  (doc.getMeta ? doc.getMeta(req, res, next) : res.status(501).json({ error: "DOC_META_NOT_IMPLEMENTED" }))
);
app.get("/api/file/by-doc/:docId", (req, res, next) =>
  (doc.presignGet ? doc.presignGet(req, res, next) : res.status(501).json({ error: "PRESIGN_NOT_IMPLEMENTED" }))
);
app.delete("/api/doc/:docId", (req, res, next) =>
  (doc.remove ? doc.remove(req, res, next) : res.status(501).json({ error: "DOC_DELETE_NOT_IMPLEMENTED" }))
);

/* ========= ASK endpoint ========= */
const ask = require("./ask");
app.post("/api/ask", (req, res, next) =>
  (ask.handleAsk ? ask.handleAsk(req, res, next) : res.status(501).json({ error: "ASK_NOT_IMPLEMENTED" }))
);

/* ========= /api 404 guard ========= */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

/* ========= start ========= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[wenku] listening on ${PORT}`);
});
