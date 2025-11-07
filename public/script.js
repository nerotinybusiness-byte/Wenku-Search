// public/script.js
import { cfg, getSettings, uploadDocument, askQuestion, listCore, getCoreBlob } from "./api.js";
import {
  loadDocs, upsertDoc, renderDocList, getActiveId, setActiveId, removeDoc,
  getSelectedIds, setSelectedIds
} from "./docs.js";

/* ============ UI refs ============ */
const modelBadge    = document.getElementById("modelBadge");
const settingsBtn   = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const apiBaseInput  = document.getElementById("apiBase");
const modelSel      = document.getElementById("modelSel");
const themeSel      = document.getElementById("themeSel");
const preloadCoreEl = document.getElementById("preloadCore");
const saveSettings  = document.getElementById("saveSettings");
const closeSettings = document.getElementById("closeSettings");

const addDocBtn   = document.getElementById("addDocBtn");
const uploadForm  = document.getElementById("uploadForm");
const fileInput   = document.getElementById("fileInput");
const uploadInfo  = document.getElementById("uploadInfo");
const docList     = document.getElementById("docList");

const coreWrap    = document.getElementById("coreWrap");
const coreList    = document.getElementById("coreList");

const selectionBar   = document.getElementById("selectionBar");
const selectionPills = document.getElementById("selectionPills");
const clearSel       = document.getElementById("clearSel");

const results       = document.getElementById("results");
const emptyState    = document.getElementById("emptyState");
const askForm       = document.getElementById("askForm");
const questionInput = document.getElementById("questionInput");

/* ============ State ============ */
let state = { model: "local", sessionId: null, pages: 0, name: null };

/* ============ Helpers ============ */
function truncateName(name, max = 28) {
  const arr = Array.from(name || "");
  return arr.length > max ? arr.slice(0, max - 1).join("") + "…" : (name || "document");
}
function escapeHtml(str) {
  return (str || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

/* ============ Service Worker (preload core) ============ */
let swReady = false;
(async function registerSW(){
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
      swReady = true;
      if (localStorage.getItem("wenku.prefetchCore") === "1") {
        navigator.serviceWorker.controller?.postMessage({ type: "WENKU_PREFETCH_CORE" });
      }
    } catch { /* optional */ }
  }
})();

/* ============ Theme init ============ */
(function initTheme() {
  const storedTheme = localStorage.getItem("wenku.theme");
  if (storedTheme === "neon-day" || storedTheme === "neon-night") {
    document.body.className = storedTheme;
  }
})();

/* ============ Settings open/close ============ */
settingsBtn?.addEventListener("click", () => {
  apiBaseInput && (apiBaseInput.value = cfg.apiBase || "/api");
  if (modelSel) modelSel.value = cfg.model || state.model || "local";
  if (themeSel) themeSel.value = document.body.classList.contains("neon-day") ? "neon-day" : "neon-night";
  if (preloadCoreEl) preloadCoreEl.checked = localStorage.getItem("wenku.prefetchCore") === "1";
  settingsPanel?.classList.remove("hidden");
});
closeSettings?.addEventListener("click", () => settingsPanel?.classList.add("hidden"));

saveSettings?.addEventListener("click", () => {
  cfg.apiBase = (apiBaseInput?.value || "/api").trim();
  if (modelSel) {
    cfg.model = modelSel.value;
    state.model = cfg.model;
  }
  modelBadge && (modelBadge.textContent =
    `model: ${state.model}${cfg.model?.includes("gemini") ? " · gemini" : cfg.model?.includes("gpt") ? " · openai" : ""}`);

  const themeKey = themeSel ? themeSel.value : "neon-night";
  document.body.className = themeKey;
  localStorage.setItem("wenku.theme", themeKey);

  if (preloadCoreEl) {
    const pre = preloadCoreEl.checked ? "1" : "0";
    localStorage.setItem("wenku.prefetchCore", pre);
    if (swReady && pre === "1") {
      navigator.serviceWorker.controller?.postMessage({ type: "WENKU_PREFETCH_CORE" });
    }
  }

  settingsPanel?.classList.add("hidden");
});

/* ============ Provider settings from server ============ */
(async function initSettings() {
  try {
    const s = await getSettings();
    state.model = s.model || "local";
    cfg.model   = state.model;
    modelBadge && (modelBadge.textContent = `model: ${state.model}${s.gemini ? " · gemini" : ""}${s.openai ? " · openai" : ""}`);
  } catch {
    modelBadge && (modelBadge.textContent = "model: (neznámý)");
  }
})();

/* ============ Core list (UI) ============ */
async function initCoreList() {
  try {
    const data = await listCore(); // { files: [...] }
    const files = Array.isArray(data?.files) ? data.files : [];
    if (!files.length) {
      coreWrap?.classList.add("hidden");
      return;
    }
    coreWrap?.classList.remove("hidden");
    coreList.innerHTML = "";

    // vyrenderuj každou položku s tlačítkem ➕ Přidat
    for (const name of files) {
      const li = document.createElement("li");
      li.className = "doc-item";
      li.innerHTML = `
        <div class="meta">
          <div class="name" title="${escapeHtml(name)}">${escapeHtml(truncateName(name, 40))}</div>
          <div class="sub">Core • uložené v cache</div>
        </div>
        <div class="doc-actions">
          <button class="btn icon" data-add="${escapeHtml(name)}" title="Přidat do seznamu">➕</button>
        </div>
      `;
      coreList.appendChild(li);
    }
  } catch {
    coreWrap?.classList.add("hidden");
  }
}
coreList?.addEventListener("click", async (e) => {
  const name = e.target?.dataset?.add;
  if (!name) return;
  // stáhni z /public/core (z cache SW), zabal do File a pošli na /api/upload
  try {
    uploadInfo && (uploadInfo.textContent = `Připravuji ${name}…`);
    const file = await getCoreBlob(name);
    await doUpload(file); // použij existující upload flow (chunkování, session, uložení do LS)
  } catch (err) {
    uploadInfo && (uploadInfo.textContent = `Chyba: ${err.message || err}`);
  }
});
initCoreList();

/* ============ Docs render & upload ============ */
function syncActiveFromStore() {
  const activeId = getActiveId();
  if (!activeId) return;
  const doc = loadDocs().find(d => d.id === activeId);
  if (doc) {
    state.sessionId = doc.sessionId;
    state.pages     = doc.pages;
    state.name      = doc.name;
    uploadInfo && (uploadInfo.textContent =
      `Vybrán: ${doc.name} (${doc.pages} stran) · session ${doc.sessionId.slice(0,8)}…`);
  }
}
renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
syncActiveFromStore();
renderSelectionBar();

addDocBtn?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", async () => {
  if (!fileInput.files?.length) return;
  await doUpload(fileInput.files[0]);
  fileInput.value = "";
});

async function doUpload(file) {
  if (uploadInfo) uploadInfo.textContent = "Nahrávám…";
  try {
    const r = await uploadDocument(file);
    state.sessionId = r.sessionId;
    state.pages     = r.pages;
    state.name      = file?.name || "document";

    const id = crypto.randomUUID();
    upsertDoc({ id, name: state.name, pages: state.pages, sessionId: state.sessionId, ts: Date.now() });
    setActiveId(id);
    renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
    if (uploadInfo) uploadInfo.textContent =
      `OK: ${state.name} (${state.pages} stran) · session ${state.sessionId.slice(0,8)}…`;
  } catch (err) {
    if (uploadInfo) uploadInfo.textContent = `Chyba: ${err.message || err}`;
  }
}

function handleSelectDoc(id) {
  const doc = loadDocs().find(d => d.id === id);
  if (!doc) return;
  state.sessionId = doc.sessionId;
  state.pages     = doc.pages;
  state.name      = doc.name;
  setActiveId(id);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
  renderSelectionBar();
  uploadInfo && (uploadInfo.textContent =
    `Vybrán: ${doc.name} (${doc.pages} stran) · session ${doc.sessionId.slice(0,8)}…`);
}

function handleDeleteDoc(id) {
  removeDoc(id);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
  renderSelectionBar();
  const active = getActiveId();
  if (!active) {
    state.sessionId = null; state.pages = 0; state.name = null;
    uploadInfo && (uploadInfo.textContent = "Dokument smazán.");
  } else {
    handleSelectDoc(active);
  }
}

/* ============ Scope bar ============ */
function handleSelectionChanged() { renderSelectionBar(); }
function renderSelectionBar() {
  const ids = getSelectedIds?.() || [];
  if (!selectionBar || !selectionPills) return;
  if (!ids.length) { selectionBar.classList.add("hidden"); selectionPills.innerHTML = ""; return; }

  selectionBar.classList.remove("hidden");
  const docs = loadDocs();
  selectionPills.innerHTML = "";

  ids.forEach(id => {
    const d = docs.find(x => x.id === id);
    if (!d) return;
    const pill = document.createElement("span");
    pill.className = "pill";
    const short = truncateName(d.name, 28);
    pill.innerHTML = `
      <span class="label" title="${escapeHtml(d.name)}">${escapeHtml(short)}</span>
      <span class="x" data-id="${id}" title="Odebrat">×</span>
    `;
    selectionPills.appendChild(pill);
  });
}
selectionPills?.addEventListener("click", (e) => {
  const id = e.target?.dataset?.id;
  if (!id) return;
  const current = (getSelectedIds?.() || []).filter(x => x !== id);
  setSelectedIds?.(current);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
  renderSelectionBar();
});
clearSel?.addEventListener("click", () => {
  setSelectedIds?.([]);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, handleSelectionChanged);
  renderSelectionBar();
});

/* ============ ASK flow ============ */
askForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = (questionInput?.value || "").trim();
  if (!q) return;
  if (!state.sessionId) { prependErrorCard("Nejdřív vyber nebo nahraj dokument."); return; }

  const cardId = prependSkeletonCard(q);
  try {
    const resp = await askQuestion(state.sessionId, q, state.model);
    let htmlAnswer = resp.answer_html;
    if (!htmlAnswer && resp.answer) {
      htmlAnswer = escapeHtml(resp.answer).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    }
    if (!htmlAnswer) htmlAnswer = "—";
    replaceCardWithAnswer(cardId, q, htmlAnswer, resp.citations);
  } catch (err) {
    replaceCardWithError(cardId, `Dotaz selhal: ${err.message || err}`);
  } finally {
    if (questionInput) questionInput.value = "";
  }
});

/* ============ Cards ============ */
let cardSeq = 0;
function prependSkeletonCard(q) {
  emptyState?.remove();
  const id = `card-${++cardSeq}`;
  const el = document.createElement("div");
  el.className = "card";
  el.id = id;
  el.innerHTML = `
    <div class="muted small">Dotaz:</div>
    <div style="margin-bottom:8px;">${escapeHtml(q)}</div>
    <div class="answer">Zpracovávám…</div>
  `;
  results?.prepend(el);
  return id;
}
function replaceCardWithAnswer(id, q, htmlAnswer, citations) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="muted small">Dotaz:</div>
    <div style="margin-bottom:8px;">${escapeHtml(q)}</div>
    <div class="answer">${htmlAnswer}</div>
  `;
  const citesWrap = document.createElement("div");
  citesWrap.className = "cites";
  (citations || []).forEach(c => {
    const norm = {
      docId:   c.docId   || c.doc?.id   || "",
      docName: c.docName || c.doc?.name || (state.name || "Dokument"),
      page:    Number(c.page || 0),
      excerpt: (c.excerpt || "").trim()
    };
    citesWrap.appendChild(makeCitationBadge(norm, true));
  });
  el.appendChild(citesWrap);
}
function replaceCardWithError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="answer" style="color:#ff5c6c">⚠️ ${escapeHtml(message)}</div>`;
}

/* ============ Citation badge ============ */
function docAbbr(name, max = 18) {
  return name && name.length > max ? name.slice(0, max - 1) + "…" : (name || "");
}
function makeCitationBadge(c, withEyeIcon = true) {
  const el = document.createElement("span");
  el.className = "badge cite";
  const name = c.docName || "Dokument";
  const page = Number(c.page || 0);
  el.dataset.docId   = c.docId || "";
  el.dataset.docName = name;
  el.dataset.page    = String(page);
  el.dataset.excerpt = (c.excerpt || "").trim();
  el.title = `${name} • str. ${page} — klikni pro náhled`;
  el.style.cursor = "pointer";
  const label = `${docAbbr(name)}: str. ${page}`;
  if (withEyeIcon) {
    el.innerHTML =
      `<svg class="eye" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
         <path d="M12 4.5c4.97 0 9.27 3.01 10.92 7.5C21.27 16.49 16.97 19.5 12 19.5S2.73 16.49 1.08 12C2.73 7.51 7.03 4.5 12 4.5zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill="currentColor"></path>
       </svg>
       <span class="label">${escapeHtml(label)}</span>`;
  } else {
    el.textContent = label;
  }
  return el;
}
