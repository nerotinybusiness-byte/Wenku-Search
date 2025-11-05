// public/script.js
import { uploadDocument, askQuestion, getSettings, cfg, setCfg } from "./api.js";

const bg = document.getElementById("bg");
const feed = document.getElementById("feed");
const uploadBtn = document.getElementById("uploadBtn");
const askBtn = document.getElementById("askBtn");
const fileInput = document.getElementById("file");
const qInput = document.getElementById("q");
const uploadInfo = document.getElementById("uploadInfo");
const themeToggle = document.getElementById("themeToggle");
const btnSettings = document.getElementById("btnSettings");
const panel = document.getElementById("settingsPanel");
const apiBase = document.getElementById("apiBase");
const modelSel = document.getElementById("model");

let sessionId = null;

// Theme
(function initTheme() {
  const stored = localStorage.getItem("wenku.theme") || "dark";
  document.body.classList.toggle("light", stored === "light");
})();
themeToggle.onclick = () => {
  const light = !document.body.classList.contains("light");
  document.body.classList.toggle("light", light);
  localStorage.setItem("wenku.theme", light ? "light" : "dark");
};

// Settings
btnSettings.onclick = () => panel.classList.toggle("hidden");
apiBase.value = cfg.apiBase;
modelSel.value = cfg.model;
apiBase.onchange = () => setCfg("apiBase", apiBase.value.trim() || "/api");
modelSel.onchange = () => setCfg("model", modelSel.value);

// Server capabilities (info only)
getSettings().catch(() => {});

// Upload
uploadBtn.onclick = async () => {
  const f = fileInput.files?.[0];
  if (!f) { alert("Vyber soubor."); return; }
  uploadBtn.disabled = true;
  try {
    const r = await uploadDocument(f);
    sessionId = r.sessionId;
    uploadInfo.textContent = `Nahráno. Stran: ${r.pages}.`;
    pushCard("✅ Dokument nahrán.", []);
  } catch {
    pushCard("❌ Upload selhal.", []);
  } finally {
    uploadBtn.disabled = false;
  }
};

// Ask
askBtn.onclick = doAsk;
qInput.addEventListener("keydown", e => { if (e.key === "Enter") doAsk(); });
async function doAsk() {
  const q = (qInput.value || "").trim();
  if (!q) return;
  if (!sessionId) { alert("Nejdřív nahraj dokument."); return; }
  askBtn.disabled = true;
  pushCard(`❓ ${escapeHtml(q)}`, []);
  try {
    const r = await askQuestion(sessionId, q);
    pushCard(escapeHtml(r.answer || ""), r.citations || []);
  } catch {
    pushCard("❌ Dotaz selhal.", []);
  } finally {
    askBtn.disabled = false;
    qInput.value = "";
  }
}

function pushCard(text, citations) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<div>${text}</div>`;
  if (citations?.length) {
    const row = document.createElement("div");
    row.className = "badges";
    for (const c of citations) {
      const b = document.createElement("span");
      b.className = "badge";
      b.title = (c.excerpt || "").slice(0, 240);
      b.textContent = `str. ${c.page}`;
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  feed.prepend(el);
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// Three.js – jemné bubliny
(function bubbles() {
  const renderer = new THREE.WebGLRenderer({ canvas: bg, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 10;

  const spheres = [];
  for (let i = 0; i < 28; i++) {
    const geo = new THREE.SphereGeometry(Math.random() * 0.8 + 0.4, 24, 24);
    const mat = new THREE.MeshBasicMaterial({ color: 0xB3D334, transparent: true, opacity: 0.11 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 4);
    scene.add(m); spheres.push(m);
  }
  function animate() {
    requestAnimationFrame(animate);
    spheres.forEach((s, i) => { s.rotation.x += 0.0008 * (i % 5 + 1); s.rotation.y += 0.0012 * (i % 7 + 1); });
    renderer.render(scene, camera);
  }
  animate();
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
})();
