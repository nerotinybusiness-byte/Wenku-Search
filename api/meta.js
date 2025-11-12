// api/meta.js
const fs = require("fs");
const path = require("path");

const META_DIR = path.join(__dirname, "..", "data", "docs");
function metaPath(docId) {
  const safe = String(docId || "").replace(/[^a-zA-Z0-9._-]/g, "");
  return path.join(META_DIR, `${safe}.json`);
}

function readMeta(docId) {
  try {
    const raw = fs.readFileSync(metaPath(docId), "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

function writeMeta(docId, json) {
  if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(metaPath(docId), JSON.stringify(json, null, 2), "utf8");
}

function deleteMeta(docId) {
  try { fs.unlinkSync(metaPath(docId)); } catch {}
}

module.exports = { readMeta, writeMeta, deleteMeta, META_DIR };
