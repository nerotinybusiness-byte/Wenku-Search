// lib/store.js
function _getGlobal() {
  if (!globalThis.__WENKU__) globalThis.__WENKU__ = { sessions: new Map(), counter: 0 };
  return globalThis.__WENKU__;
}

function ensureSession() {
  const g = _getGlobal();
  const id = "s_" + (++g.counter).toString(36) + "_" + Date.now().toString(36);
  g.sessions.set(id, { id });
  return { id };
}

function putSession(id, obj) {
  const g = _getGlobal();
  const cur = g.sessions.get(id) || { id };
  g.sessions.set(id, { ...cur, ...obj });
}

function getSession(id) {
  const g = _getGlobal();
  return g.sessions.get(id);
}

function findSessionByFileHash(hash) {
  const g = _getGlobal();
  for (const s of g.sessions.values()) {
    if (s.fileHash === hash && s.pages?.length) return s;
  }
  return null;
}

module.exports = { ensureSession, putSession, getSession, findSessionByFileHash };
