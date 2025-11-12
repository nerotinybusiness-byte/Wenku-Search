// public/viewer.js — inline PDF overlay (presigned URL z /api/file/by-doc/:docId)
import { getFileUrlByDoc } from "./api.js";

(function () {
  const overlay = document.getElementById("viewerOverlay");
  const frame   = document.getElementById("viewerFrame");
  const nameEl  = document.getElementById("viewerDocName");
  const pageEl  = document.getElementById("viewerPage");
  const openNew = document.getElementById("viewerOpenNew");
  const btnClose= document.getElementById("viewerClose");

  async function openViewer({ docId, docName, page }) {
    const p = Number(page || 1);
    try {
      const { url } = await getFileUrlByDoc(docId);
      const target = `${url}#page=${p}`;
      frame.src = target;
      nameEl.textContent = docName || "Dokument";
      pageEl.textContent = String(p);
      openNew.href = target;

      overlay.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    } catch {
      alert("Nedaří se otevřít náhled PDF.");
    }
  }

  function closeViewer() {
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    frame.src = "about:blank";
  }

  // Citace → otevřít viewer
  document.addEventListener("click", (e) => {
    const cite = e.target.closest?.(".badge.cite");
    if (!cite) return;
    const docId = cite.dataset.docId || "";
    const docName = cite.dataset.docName || "Dokument";
    const page = cite.dataset.page || "1";
    if (!docId) return;
    e.preventDefault();
    openViewer({ docId, docName, page });
  });

  // Zavření
  btnClose?.addEventListener("click", closeViewer);
  overlay?.addEventListener("click", (e) => { if (e.target?.dataset?.close === "1") closeViewer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeViewer(); });
})();
