// Jednoduchý perzistentní store dokumentů (localStorage).
// Každá položka: { id, name, pages, sessionId, ts }
const LS_KEY = "wenku.docs.v1";
const ACTIVE_KEY = "wenku.docs.active";
const SELECTED_KEY = "wenku.docs.selected.v1";

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

export function getSelectedIds() {
  try { return JSON.parse(localStorage.getItem(SELECTED_KEY) || "[]"); }
  catch { return []; }
}
export function setSelectedIds(arr) {
  localStorage.setItem(SELECTED_KEY, JSON.stringify(arr || []));
}
export function isSelected(id) {
  return getSelectedIds().includes(id);
}
export function toggleSelected(id) {
  const cur = getSelectedIds();
  const i = cur.indexOf(id);
  if (i >= 0) cur.splice(i, 1); else cur.push(id);
  setSelectedIds(cur);
  return cur;
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
  // Odebíráme i z výběru
  setSelectedIds(getSelectedIds().filter(x => x !== id));
  const active = getActiveId();
  if (active === id) setActiveId(list[0]?.id || null);
}

/**
 * Vykreslí seznam dokumentů.
 * - onSelect(id): klik kamkoliv na kartu vybere dokument
 * - onDelete(id): klik na koš
 * - onSelectionChanged(): změna checkboxu (multi-select)
 */
export function renderDocList(container, onSelect, onDelete, onSelectionChanged) {
  const docs = loadDocs();
  const active = getActiveId();
  const selected = new Set(getSelectedIds());

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

    // Checkbox + meta + pouze delete (bez „Vybrat“)
    li.innerHTML = `
      <label class="chk" data-act="chk" title="Přidat do výběru">
        <input type="checkbox" ${selected.has(d.id) ? "checked" : ""} />
      </label>
      <div class="meta">
        <div class="name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>
        <div class="sub">${d.pages} stran • ${new Date(d.ts).toLocaleString()}</div>
      </div>
      <div class="doc-actions">
        <button class="btn icon" data-act="delete" title="Smazat">🗑️</button>
      </div>
    `;

    li.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      const label = e.target.closest("label[data-act='chk']");
      if (btn && btn.dataset.act === "delete") {
        onDelete?.(d.id);
        return;
      }
      if (label) {
        // Toggle selection without triggering card select
        const input = label.querySelector("input");
        input.checked = !input.checked;
        toggleSelected(d.id);
        onSelectionChanged?.();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Select card
      onSelect?.(d.id);
    });

    container.appendChild(li);
  }
}

function escapeHtml(str) {
  return (str || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
