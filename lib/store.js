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
  const current = g.sessions.get(id) || { id };
  g.sessions.set(id, { ...current, ...obj });
}

function getSession(id) {
  const g = _getGlobal();
  return g.sessions.get(id);
}

module.exports = { ensureSession, putSession, getSession };
