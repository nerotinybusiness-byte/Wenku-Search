import { cfg, getSettings, uploadDocument, askQuestion } from "./api.js";
import { loadDocs, upsertDoc, renderDocList, getActiveId, setActiveId, removeDoc } from "./docs.js";

// ======= UI references
const modelBadge = document.getElementById("modelBadge");
const themeToggle = document.getElementById("themeToggle");

const addDocBtn = document.getElementById("addDocBtn");
const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const uploadInfo = document.getElementById("uploadInfo");
const docList = document.getElementById("docList");

const results = document.getElementById("results");
const emptyState = document.getElementById("emptyState");

const askForm = document.getElementById("askForm");
const questionInput = document.getElementById("questionInput");

// ======= State
let state = {
  model: "local",
  sessionId: null,
  pages: 0,
  name: null
};

// ======= Theme
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("wenku.theme", document.body.classList.contains("light") ? "light" : "dark");
});
if (localStorage.getItem("wenku.theme") === "light") document.body.classList.add("light");

// ======= Settings
(async function initSettings() {
  try {
    const s = await getSettings();
    state.model = s.model || "local";
    cfg.model = state.model;
    modelBadge.textContent = `model: ${state.model}${s.gemini ? " · gemini" : ""}${s.openai ? " · openai" : ""}`;
  } catch {
    modelBadge.textContent = "model: (neznámý)";
  }
})();

// ======= Docs list render
function syncActiveFromStore() {
  const activeId = getActiveId();
  if (!activeId) return;
  const doc = loadDocs().find(d => d.id === activeId);
  if (doc) {
    state.sessionId = doc.sessionId;
    state.pages = doc.pages;
    state.name = doc.name;
    uploadInfo.textContent = `Vybrán: ${doc.name} (${doc.pages} stran) · session ${doc.sessionId.slice(0,8)}…`;
  }
}
renderDocList(docList, handleSelectDoc, handleDeleteDoc);
syncActiveFromStore();

// ======= Upload flow (➕ tlačítko)
addDocBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  if (!fileInput.files?.length) return;
  await doUpload(fileInput.files[0]);
  fileInput.value = "";
});

async function doUpload(file) {
  uploadInfo.textContent = "Nahrávám…";
  try {
    const r = await uploadDocument(file);
    state.sessionId = r.sessionId;
    state.pages = r.pages;
    state.name = r.filename || "document";

    const id = crypto.randomUUID();
    upsertDoc({ id, name: state.name, pages: state.pages, sessionId: state.sessionId, ts: Date.now() });
    setActiveId(id);
    renderDocList(docList, handleSelectDoc, handleDeleteDoc);

    uploadInfo.textContent = `OK: ${state.name} (${state.pages} stran) · session ${state.sessionId.slice(0,8)}…`;
  } catch (err) {
    uploadInfo.textContent = `Chyba: ${err.message || err}`;
  }
}

function handleSelectDoc(id) {
  const doc = loadDocs().find(d => d.id === id);
  if (!doc) return;
  state.sessionId = doc.sessionId;
  state.pages = doc.pages;
  state.name = doc.name;
  setActiveId(id);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc);
  uploadInfo.textContent = `Vybrán: ${doc.name} (${doc.pages} stran) · session ${doc.sessionId.slice(0,8)}…`;
}

function handleDeleteDoc(id) {
  removeDoc(id);
  renderDocList(docList, handleSelectDoc, handleDeleteDoc);
  const active = getActiveId();
  if (!active) {
    state.sessionId = null;
    state.pages = 0;
    state.name = null;
    uploadInfo.textContent = "Dokument smazán.";
  } else {
    handleSelectDoc(active);
  }
}

// ======= Ask flow
askForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = (questionInput.value || "").trim();
  if (!q) return;
  if (!state.sessionId) {
    prependErrorCard("Nejdřív vyber nebo nahraj dokument.");
    return;
  }

  const placeholderId = prependSkeletonCard(q);
  try {
    const { answer_html, citations } = await askQuestion(state.sessionId, q, state.model);
    replaceCardWithAnswer(placeholderId, q, answer_html, citations);
  } catch (err) {
    replaceCardWithError(placeholderId, `Dotaz selhal: ${err.message || err}`);
  } finally {
    questionInput.value = "";
  }
});

// ======= Cards render
let cardSeq = 0;

function prependSkeletonCard(q) {
  emptyState?.remove();
  const id = `card-${++cardSeq}`;
  const el = document.createElement("div");
  el.className = "card";
  el.id = id;
  el.innerHTML = `
    <div class="muted small">Dotaz:</div>
    <div class="muted" style="margin-bottom:8px;">${escapeHtml(q)}</div>
    <div class="answer">Zpracovávám…</div>
  `;
  results.prepend(el);
  return id;
}

function replaceCardWithAnswer(id, q, htmlAnswer, citations) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="muted small">Dotaz:</div>
    <div style="margin-bottom:8px;">${escapeHtml(q)}</div>
    <div class="answer">${htmlAnswer || "—"}</div>
    ${renderCitationsRow(citations)}
  `;
}

function renderCitationsRow(citations) {
  if (!citations?.length) return "";
  const badges = citations
    .map(
      (c) =>
        `<span class="badge tooltip" data-tip="${escapeHtml(c.excerpt)}"><span class="dot"></span> str. ${c.page}</span>`
    )
    .join("");
  return `<div class="row-citations">${badges}</div>`;
}

function replaceCardWithError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="answer" style="color: var(--danger);">⚠️ ${escapeHtml(message)}</div>`;
}

function prependErrorCard(message) {
  emptyState?.remove();
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<div class="answer" style="color: var(--danger);">⚠️ ${escapeHtml(message)}</div>`;
  results.prepend(el);
}

function escapeHtml(str) {
  return (str || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
