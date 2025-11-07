'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSession } = require('../lib/store');

const TOKEN_TTL_SEC = 300; // 5 min
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function getSessionMeta(docId) {
  const s = getSession(docId);
  if (!s) return null;
  const filePath = s.filePath;
  const mime = s.mime || 'application/octet-stream';
  const name = s.filename || s.name || 'document.pdf';
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { filePath, mime, name };
}

// POST /api/file/sign  { docId }  → { url, name, mime }
async function signFileUrlHandler(req, res) {
  try {
    const { docId } = req.body || {};
    if (!docId) return res.status(400).json({ error: 'Missing docId' });

    const meta = getSessionMeta(docId);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    const secret = process.env.FILE_TOKEN_SECRET || '';
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
    const base = `${docId}.${exp}`;
    const sig = secret ? sign(base, secret) : 'dev';

    const url = `/api/file/${encodeURIComponent(docId)}?e=${exp}&t=${sig}`;
    res.json({ url, name: meta.name, mime: meta.mime });
  } catch (e) {
    res.status(500).json({ error: 'sign failed' });
  }
}

// GET /api/file/:docId?e=&t=
async function streamFileHandler(req, res) {
  try {
    const { docId } = req.params;
    const { e, t } = req.query;

    const meta = getSessionMeta(docId);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    const secret = process.env.FILE_TOKEN_SECRET || '';
    if (secret) {
      const now = Math.floor(Date.now() / 1000);
      const exp = parseInt(String(e), 10);
      const sig = String(t || '');
      if (!exp || !sig) return res.status(400).json({ error: 'Bad token' });
      if (exp < now) return res.status(403).json({ error: 'Token expired' });
      const ok = sig === sign(`${docId}.${exp}`, secret);
      if (!ok) return res.status(403).json({ error: 'Bad signature' });
    }

    res.setHeader('Content-Type', meta.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name)}"`);
    return res.sendFile(path.resolve(meta.filePath));
  } catch (e) {
    res.status(500).json({ error: 'stream failed' });
  }
}

module.exports = { signFileUrlHandler, streamFileHandler, UPLOAD_DIR, ensureUploadsDir };
