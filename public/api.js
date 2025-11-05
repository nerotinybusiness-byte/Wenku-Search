// public/api.js
export const cfg = {
  apiBase: localStorage.getItem("wenku.apiBase") || "/api",
  model: localStorage.getItem("wenku.model") || "gemini-1.5-flash",
};
export function setCfg(k, v) {
  cfg[k] = v;
  localStorage.setItem(`wenku.${k}`, v);
}
export async function uploadDocument(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${cfg.apiBase}/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("Upload selhal");
  return r.json(); // {sessionId,pages}
}
export async function askQuestion(sessionId, q) {
  const r = await fetch(`${cfg.apiBase}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, q, model: cfg.model })
  });
  if (!r.ok) throw new Error("Dotaz selhal");
  return r.json(); // {answer, citations}
}
export async function getSettings() {
  const r = await fetch(`${cfg.apiBase}/settings`);
  return r.json();
}
