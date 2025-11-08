// public/viewer.js
(function () {
  document.addEventListener("click", (e) => {
    const cite = e.target.closest?.(".badge.cite");
    if (!cite) return;

    const docId = cite.dataset.docId || "";
    const page = Number(cite.dataset.page || "1");
    if (!docId) return;

    const url = `/api/file/${encodeURIComponent(docId)}#page=${page}`;
    window.open(url, "_blank", "noopener");
  });
})();
