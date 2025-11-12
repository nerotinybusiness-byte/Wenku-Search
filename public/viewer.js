// public/viewer.js — inline viewer přes R2 presigned URL
(function () {
  const overlay = document.getElementById("viewerOverlay");
  const frame   = document.getElementById("viewerFrame");
  const titleEl = document.getElementById("viewerTitle");
  const nameEl  = document.getElementById("viewerDocName");
  const pageEl  = document.getElementById("viewerPage");
  const openNew = document.getElementById("viewerOpenNew");
  const btnClose= document.getElementById("viewerClose");

  async function openViewer({ docId, docName, page }) {
    const p = Number(page || 1);
    try {
      const r = await fetch(`/api/file/by-doc/${encodeURIComponent(docId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "presign failed");
      const url = j.url;
      frame.src = `${url}#page=${p}`;
      openNew.href = `${url}#page=${p}`;
    } catch (e) {
      frame.srcdoc = `<pre style="padding:16px;color:#ff5c6c">Náhled selhal: ${String(e.message || e)}</pre>`;
      openNew.removeAttribute("href");
    }
    nameEl.textContent = docName || "Dokument";
    pageEl.textContent = String(p);
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    frame.src = "about:blank";
  }

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

  btnClose?.addEventListener("click", closeViewer);
  overlay?.addEventListener("click", (e) => { if (e.target?.dataset?.close === "1") closeViewer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeViewer(); });
})();
