// public/api.js
export const cfg = { apiBase: "/api", model: "local" };

/* ---- SETTINGS ---- */
export async function getSettings() {
  const r = await fetch(`${cfg.apiBase}/settings`, { cache: "no-store" });
  if (!r.ok) throw new Error("settings failed");
  return r.json();
}

/* ---- UPLOAD ---- */
export async function uploadDocument(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${cfg.apiBase}/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { sessionId, docId, pages, name, writeKey? }
}

/* ---- ASK ---- */
export async function askQuestion(sessionId, q, model) {
  const r = await fetch(`${cfg.apiBase}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, q, model }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { answer|answer_html, citations }
}

/* ---- DOC (presign) ---- */
export async function getFileUrlByDoc(docId) {
  const r = await fetch(`${cfg.apiBase}/file/by-doc/${encodeURIComponent(docId)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { url }
}
