// api/server.js
const path = require("path");
const express = require("express");
const compression = require("compression");

const app = express();

/* ========= basics ========= */
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ========= static ========= */
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(
  express.static(PUBLIC_DIR, {
    index: "index.html",
    extensions: ["html"],
  })
);

/* ========= /api/settings ========= */
const { handleSettings } = require("./settings");
app.get("/api/settings", handleSettings);

/* ========= /api/upload ========= */
const { uploadMulter, handleUpload } = require("./upload");

// očekává field "file" (frontend to tak posílá)
app.post(
  "/api/upload",
  uploadMulter.single("file"),
  (req, res) => handleUpload(req, res)
);

/* ========= /api/doc & /api/file/by-doc ========= */
const { getDoc, fileByDoc, deleteDoc } = require("./doc");

app.get("/api/doc/:docId", (req, res) => getDoc(req, res));
app.get("/api/file/by-doc/:docId", (req, res) => fileByDoc(req, res));
app.delete("/api/doc/:docId", (req, res) => deleteDoc(req, res));

/* ========= /api/ask ========= */
const { handleAsk } = require("./ask");
app.post("/api/ask", (req, res) => handleAsk(req, res));

/* ========= /api 404 guard ========= */
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* ========= start ========= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[wenku] listening on ${PORT}`);
});
