// PDF viewer modal (MVP: skok na stranu; highlight přijde v další iteraci)
(() => {
  // Modal skeleton
  const modal = document.createElement('div');
  modal.id = 'doc-viewer-modal';
  modal.innerHTML = `
    <div class="overlay" data-close></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Náhled citace">
      <div class="head">
        <div class="title" id="viewerTitle">Dokument</div>
        <div class="meta" id="viewerMeta"></div>
        <button class="close" data-close>&times;</button>
      </div>
      <div class="body">
        <iframe id="viewerFrame" src="about:blank"></iframe>
        <div class="excerpt" id="viewerExcerpt" style="display:none">
          <span>Výňatek:</span>
          <code id="viewerExcerptText"></code>
          <button id="viewerCopy">Zkopírovat</button>
          <span style="opacity:.7">→ V náhledu lze použít Ctrl/Cmd+F</span>
        </div>
      </div>
    </div>`;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(modal));

  const byId = id => modal.querySelector('#' + id);
  const frame = byId('viewerFrame');
  const title = byId('viewerTitle');
  const meta = byId('viewerMeta');
  const excerptWrap = byId('viewerExcerpt');
  const excerptText = byId('viewerExcerptText');
  const copyBtn = byId('viewerCopy');

  function openViewer({ url, name, page, excerpt }) {
    title.textContent = name || 'Dokument';
    meta.textContent = page ? `str. ${page}` : '';
    frame.src = page ? `${url}#page=${page}` : url;

    if (excerpt && excerpt.trim()) {
      excerptText.textContent = excerpt.trim();
      excerptWrap.style.display = 'flex';
    } else {
      excerptWrap.style.display = 'none';
    }
    modal.classList.add('open');
    setTimeout(() => frame.focus(), 50);
  }

  function closeViewer() {
    frame.src = 'about:blank';
    modal.classList.remove('open');
  }

  modal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeViewer();
  });
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(excerptText.textContent);
      copyBtn.textContent = 'Zkopírováno';
      setTimeout(() => (copyBtn.textContent = 'Zkopírovat'), 1200);
    } catch {}
  });

  // Podepsané URL
  async function signFileUrl(docId) {
    const r = await fetch('/api/file/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'sign failed');
    return r.json(); // { url, name, mime }
  }

  // Delegovaný click na citace (pokud FE přidává data-* atributy)
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('.badge.cite');
    if (!el) return;

    const docId = el.dataset.docId || el.getAttribute('data-doc-id');
    const page = parseInt(el.dataset.page || el.getAttribute('data-page') || '0', 10) || undefined;
    const excerpt = el.dataset.excerpt || el.getAttribute('data-excerpt') || '';

    if (!docId) return; // bez docId tady úmyslně nic neděláme

    try {
      const { url, name } = await signFileUrl(docId);
      openViewer({ url, name: name || el.dataset.docName || 'Dokument', page, excerpt });
    } catch (err) {
      console.warn('viewer open failed:', err?.message || err);
    }
  });

  // Globální API
  window.WenkuViewer = { open: openViewer, close: closeViewer };
})();
