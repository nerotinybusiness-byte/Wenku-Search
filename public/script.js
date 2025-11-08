import { cfg, getSettings, uploadDocument, askQuestion } from "./api.js";
import {
  loadDocs, upsertDoc, renderDocList, getActiveId, setActiveId, removeDoc
} from "./docs.js";

/* ============ UI refs ============ */
const modelBadge    = document.getElementById("modelBadge");
const settingsBtn   = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const apiBaseInput  = document.getElementById("apiBase");
const modelSel      = document.getElementById("modelSel");
const themeSel      = document.getElementById("themeSel");
const saveSettings  = document.getElementById("saveSettings");
const closeSettings = document.getElementById("closeSettings");

const addDocBtn   = document.getElementById("addDocBtn");
const uploadForm  = document.getElementById("uploadForm");
const fileInput   = document.getElementById("fileInput");
const uploadInfo  = document.getElementById("uploadInfo");
const docList     = document.getElementById("docList");

const results       = document.getElementById("results");
const emptyState    = document.getElementById("emptyState");
const askForm       = document.getElementById("askForm");
const questionInput = document.getElementById("questionInput");

/* ============ State ============ */
let state = { model: "local", sessionId: null, pages: 0, name: null };

/* ============ Theme init ============ */
(function initTheme() {
  const storedTheme = localStorage.getItem("wenku.theme");
  document.body.className = (storedTheme === "neon-day") ? "neon-day" : "neon-night";
})();

/* ============ Settings open/close ============ */
settingsBtn?.addEventListener("click", () => {
  apiBaseInput && (apiBaseInput.value = cfg.apiBase || "/api");
  if (modelSel) modelSel.value = cfg.model || state.model || "local";
  if (themeSel) themeSel.value = document.body.classList.contains("neon-day") ? "neon-day" : "neon-night";
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
renderDocList(docList, handleSelectDoc, handleDeleteDoc, null);
syncActiveFromStore();

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
    state.name      = r.name || file?.name || "document";

    const id = crypto.randomUUID();
    upsertDoc({ id, name: state.name, pages: state.pages, sessionId: state.sessionId, ts: Date.now() });
    setActiveId(id);
    renderDocList(docList, handleSelectDoc, handleDeleteDoc, null);
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
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, null);
  uploadInfo && (uploadInfo.textContent =
    `Vybrán: ${doc.name} (${doc.pages} stran) · session ${doc.sessionId.slice(0,8)}…`);
}

function handleDeleteDoc(id) {
  removeDoc(id);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc, null);
  const active = getActiveId();
  if (!active) {
    state.sessionId = null; state.pages = 0; state.name = null;
    uploadInfo && (uploadInfo.textContent = "Dokument smazán.");
  } else {
    handleSelectDoc(active);
  }
}

/* ============ ASK flow ============ */
askForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = (questionInput?.value || "").trim();
  if (!q) return;
  if (!state.sessionId) { prependErrorCard("Nejdřív nahraj a vyber dokument."); return; }

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

/* ============ Cards & citations ============ */
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
      docId:   c.docId || "",
      docName: c.docName || (state.name || "Dokument"),
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

function escapeHtml(str) {
  return (str || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
