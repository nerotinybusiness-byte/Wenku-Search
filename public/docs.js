// Jednoduchý perzistentní store dokumentů (localStorage).
// Každá položka: { id, name, pages, sessionId, ts }
const LS_KEY = "wenku.docs.v1";
const ACTIVE_KEY = "wenku.docs.active";

export function loadDocs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}
export function saveDocs(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
export function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}
export function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY);
}

export function upsertDoc(doc) {
  const list = loadDocs();
  const idx = list.findIndex(d => d.id === doc.id);
  if (idx >= 0) list[idx] = doc; else list.unshift(doc);
  saveDocs(list);
  return doc.id;
}

export function removeDoc(id) {
  const list = loadDocs().filter(d => d.id !== id);
  saveDocs(list);
  const active = getActiveId();
  if (active === id) setActiveId(list[0]?.id || null);
}

export function renderDocList(container, onSelect, onDelete) {
  const docs = loadDocs();
  const active = getActiveId();
  container.innerHTML = "";
  if (!docs.length) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.textContent = "Žádné dokumenty. Klikni na ➕ a nahraj.";
    container.appendChild(li);
    return;
  }
  for (const d of docs) {
    const li = document.createElement("li");
    li.className = "doc-item" + (d.id === active ? " active" : "");
    li.dataset.id = d.id;

    li.innerHTML = `
      <div class="meta">
        <div class="name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>
        <div class="sub">${d.pages} stran • ${new Date(d.ts).toLocaleString()}</div>
      </div>
      <div class="doc-actions">
        <button class="btn icon" data-act="select" title="Vybrat">📄</button>
        <button class="btn icon" data-act="delete" title="Smazat">🗑️</button>
      </div>
    `;

    li.addEventListener("click", (e) => {
      const act = (e.target.closest("button")?.dataset?.act) || "select";
      if (act === "delete") {
        onDelete?.(d.id);
      } else {
        onSelect?.(d.id);
      }
    });

    container.appendChild(li);
  }
}

function escapeHtml(str) {
  return (str || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
