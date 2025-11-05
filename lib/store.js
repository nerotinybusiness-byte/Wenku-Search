// lib/store.js
function _getGlobal() {
  if (!globalThis.__WENKU__) globalThis.__WENKU__ = { sessions: new Map(), counter: 0 };
  return globalThis.__WENKU__;
}

export function ensureSession() {
  const g = _getGlobal();
  const id = "s_" + (++g.counter).toString(36) + "_" + Date.now().toString(36);
  g.sessions.set(id, { id });
  return { id };
}

export function putSession(id, obj) {
  const g = _getGlobal();
  g.sessions.set(id, { id, ...obj });
}

export function getSession(id) {
  const g = _getGlobal();
  return g.sessions.get(id);
}
