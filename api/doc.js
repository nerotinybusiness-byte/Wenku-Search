// api/doc.js
const { readMeta, deleteMeta } = require("./meta");
const { presignGet, deleteObject } = require("./storage/r2");
const { putSession, removeSession } = require("../lib/store");

function ok(res, data) { res.json(data); }
function bad(res, code, msg) { res.status(code).json({ error: msg }); }

async function getDoc(req, res) {
  try {
    const { docId } = req.params;
    const meta = readMeta(docId);
    if (!meta) return bad(res, 404, "Document not found");

    // Hydratuj RAM session (ID = docId)
    putSession(docId, {
      id: docId,
      name: meta.name,
      pages: new Array(meta.pageCount || 1).fill(""),
      chunks: meta.chunks || [],
      fileHash: meta.sha1
    });

    return ok(res, { sessionId: docId, name: meta.name, pages: meta.pageCount || 1 });
  } catch (e) {
    console.error("getDoc error", e);
    return bad(res, 500, "getDoc failed");
  }
}

async function fileByDoc(req, res) {
  try {
    const { docId } = req.params;
    const meta = readMeta(docId);
    if (!meta) return bad(res, 404, "Document not found");
    const url = await presignGet(meta.r2Key, 3600);
    return ok(res, { url });
  } catch (e) {
    console.error("fileByDoc error", e);
    return bad(res, 500, "file url failed");
  }
}

async function deleteDoc(req, res) {
  try {
    const { docId } = req.params;
    const meta = readMeta(docId);
    if (!meta) return bad(res, 404, "Document not found");

    const header = String(req.get("authorization") || "");
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
    const hasManage = process.env.MANAGE_TOKEN && bearer === process.env.MANAGE_TOKEN;
    const hasWriteKey = req.query.key && req.query.key === meta.writeKey;
    if (!hasManage && !hasWriteKey) return bad(res, 403, "Forbidden");

    await deleteObject(meta.r2Key);
    deleteMeta(docId);
    removeSession(docId);
    return ok(res, { ok: true });
  } catch (e) {
    console.error("deleteDoc error", e);
    return bad(res, 500, "delete failed");
  }
}

module.exports = { getDoc, fileByDoc, deleteDoc };
