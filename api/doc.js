// api/doc.js
const fs = require("fs");
const path = require("path");
const { putObject, presignGet, deleteObject } = require("./storage/r2");

const META_DIR = path.join(__dirname, "..", "data", "docs");
function metaPath(id) { return path.join(META_DIR, `${id}.json`); }
function readMeta(id) {
  const p = metaPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

exports.getDoc = (req, res) => {
  const id = req.params.docId;
  const m = readMeta(id);
  if (!m) return res.status(404).json({ error: "doc not found" });
  res.json(m);
};

exports.fileByDoc = async (req, res) => {
  try {
    const id = req.params.docId;
    const m = readMeta(id);
    if (!m) return res.status(404).json({ error: "doc not found" });

    // Pokud ještě není v R2, nahraj (lazy)
    if (!m.r2Key && m.filePath && fs.existsSync(m.filePath)) {
      const buf = fs.readFileSync(m.filePath);
      const key = `${id}${path.extname(m.filePath) || ""}`;
      await putObject(key, buf, m.mime || "application/octet-stream");
      m.r2Key = key;
      fs.writeFileSync(metaPath(id), JSON.stringify(m, null, 2));
    }
    const url = await presignGet(m.r2Key);
    res.json({ url });
  } catch (e) {
    console.error("fileByDoc error:", e);
    res.status(500).json({ error: "presign failed" });
  }
};

exports.deleteDoc = async (req, res) => {
  const id = req.params.docId;
  const m = readMeta(id);
  if (!m) return res.status(404).json({ ok: false, error: "not found" });
  try {
    if (m.r2Key) { try { await deleteObject(m.r2Key); } catch (e) { console.warn("R2 delete warn:", e?.message); } }
    try { fs.unlinkSync(m.filePath); } catch {}
    try { fs.unlinkSync(metaPath(id)); } catch {}
    res.json({ ok: true });
  } catch (e) {
    console.error("deleteDoc error:", e);
    res.status(500).json({ ok: false, error: "delete failed" });
  }
};
