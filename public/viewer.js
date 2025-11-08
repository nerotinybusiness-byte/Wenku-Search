// public/viewer.js — otevření PDF inline v overlayi (bez nové záložky)
(function () {
  const overlay = document.getElementById("viewerOverlay");
  const frame   = document.getElementById("viewerFrame");
  const titleEl = document.getElementById("viewerTitle");
  const nameEl  = document.getElementById("viewerDocName");
  const pageEl  = document.getElementById("viewerPage");
  const openNew = document.getElementById("viewerOpenNew");
  const btnClose= document.getElementById("viewerClose");

  function openViewer({ docId, docName, page }) {
    const p = Number(page || 1);
    const url = `/api/file/${encodeURIComponent(docId)}#page=${p}`;
    frame.src = url;
    nameEl.textContent = docName || "Dokument";
    pageEl.textContent = String(p);
    openNew.href = url;

    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    // vyprázdni src, ať se release-ne PDF renderer
    frame.src = "about:blank";
  }

  // Klik na citaci (badge.cite) otevře viewer
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
  overlay?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "1") closeViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeViewer();
  });
})();
