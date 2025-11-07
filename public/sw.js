/* public/sw.js — Wenku core prefetch */
const CORE_CACHE = "wenku-core-v1";
const CORE_MANIFEST_URL = "/api/core-manifest";
const CORE_MAX_BYTES = 6 * 1024 * 1024; // prefetch jen malé PDF (≤ ~6 MB)

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {})());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // smaž staré cache, pokud změníme verzi
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith("wenku-core-") && n !== CORE_CACHE)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const { type } = event.data || {};
  if (type === "WENKU_PREFETCH_CORE") {
    event.waitUntil(prefetchCore());
  }
  if (type === "WENKU_CLEAR_CORE") {
    event.waitUntil(caches.delete(CORE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // pro core PDF: stale-while-revalidate
  if (url.pathname.startsWith("/api/file/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CORE_CACHE);
      const cached = await cache.match(event.request, { ignoreSearch: false });
      const net = fetch(event.request).then(async (resp) => {
        if (resp.ok) {
          try { await cache.put(event.request, resp.clone()); } catch {}
        }
        return resp;
      }).catch(() => cached);
      return cached || net;
    })());
  }
});

async function prefetchCore() {
  try {
    const r = await fetch(CORE_MANIFEST_URL, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    const items = (j && Array.isArray(j.items)) ? j.items : [];
    if (!items.length) return;

    const cache = await caches.open(CORE_CACHE);
    for (const item of items) {
      try {
        if (!item?.url || typeof item.size !== "number") continue;
        if (item.size > CORE_MAX_BYTES) continue; // velké PDF nebereme celé
        const req = new Request(item.url, { cache: "no-store" });
        const exists = await cache.match(req);
        if (exists) continue;
        const resp = await fetch(req);
        if (resp.ok) await cache.put(req, resp);
      } catch {}
    }
  } catch {}
}
