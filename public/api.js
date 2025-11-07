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
  return r.json(); // { sessionId, pages }
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

/* ---- CORE API (původní "listCore" pro ➕ Přidat) ---- */
export async function listCore() {
  // Zpětná kompatibilita – pokud máš endpoint /api/core, vrátí { files:[...] }
  const r = await fetch(`${cfg.apiBase}/core`, { cache: "no-store" });
  if (!r.ok) return { files: [] };
  return r.json();
}

/* ---- CORE Pack B (⚡ Dotazovat bez uploadu) ---- */
export async function listCoreSessions() {
  // Vrátí { version, docs:[{slug,name,pages,sessionId}] }
  const r = await fetch(`${cfg.apiBase}/core/list`, { cache: "no-store" });
  if (!r.ok) return { version: null, docs: [] };
  return r.json();
}

/* ---- Získání originálního core souboru (pro ➕ Přidat) ---- */
export async function getCoreBlob(name) {
  // bere statický soubor z /public/core/<name> (rychlé)
  const res = await fetch(`/core/${encodeURIComponent(name)}`, { cache: "reload" });
  if (!res.ok) throw new Error(`Core soubor '${name}' nenalezen`);
  const blob = await res.blob();

  // doplň mime, pokud server nedal
  const ext = (name.split(".").pop() || "").toLowerCase();
  const fallback =
    ext === "pdf" ? "application/pdf" :
    ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
    "text/plain";

  return new File([blob], name, { type: res.headers.get("content-type") || fallback });
}
