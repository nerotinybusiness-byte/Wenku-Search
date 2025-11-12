// lib/retriever.js (CommonJS)
// - tokenize: česky-friendly, uklízí diakritiku jen minimálně
// - rankBM25: standard k1/b, df/idf, avgdl
// - pickExcerpts: když pages[] chybí (Core B), vezme excerpt z chunk.text
// - retrieveChunksForDoc: načte chunky z RAM podle sessionId a vrátí seřazené top N

const { getSession } = require("./store");

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/g)
    .filter(Boolean);
}

function rankBM25(query, chunks) {
  const terms = Array.isArray(query) ? query : tokenize(String(query || ""));
  const N = chunks?.length || 1;
  const k1 = 1.5, b = 0.75;

  const dl = (chunks || []).map(c => (c.terms?.length ?? tokenize(c.text || "").length));
  const avgdl = dl.reduce((a, b) => a + b, 0) / (dl.length || 1);

  // df
  const df = Object.create(null);
  for (let i = 0; i < (chunks || []).length; i++) {
    const seen = new Set();
    const termsDoc = chunks[i].terms || tokenize(chunks[i].text || "");
    for (const t of termsDoc) {
      if (!terms.includes(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      df[t] = (df[t] || 0) + 1;
    }
  }

  function idf(t) {
    const dft = df[t] || 0.5;
    return Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
  }

  const scored = (chunks || []).map((c, i) => {
    const termsDoc = c.terms || tokenize(c.text || "");
    const tf = Object.create(null);
    for (const t of termsDoc) {
      if (!terms.includes(t)) continue;
      tf[t] = (tf[t] || 0) + 1;
    }
    const len = dl[i] || 1;
    let score = 0;
    for (const t of Object.keys(tf)) {
      const tfw = tf[t];
      score += idf(t) * ((tfw * (k1 + 1)) / (tfw + k1 * (1 - b + (b * len) / (avgdl || 1))));
    }
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * pickExcerpts – funguje pro single-doc i multi-doc.
 * @param query string
 * @param ranked [{docId?, pageStart, text, ...}] – výsledek rankBM25
 * @param pagesRef Array<string> | Map<string, Array<string>> – volitelné
 * @param opts { max?:number, span?:number }
 */
function pickExcerpts(query, ranked, pagesRef, opts = {}) {
  const out = [];
  const max  = opts.max  ?? 3;
  const span = opts.span ?? 220;

  const qTerms = tokenize(String(query || ""));
  const main = qTerms[0] || "";

  const getPages = (docId) => {
    if (!pagesRef) return null;
    if (Array.isArray(pagesRef)) return pagesRef;
    if (pagesRef && typeof pagesRef === "object") return pagesRef[docId] || null;
    return null;
  };

  const seen = new Set();
  for (const c of (ranked || [])) {
    if (out.length >= max) break;

    const page = typeof c.pageStart === "number" ? c.pageStart : 0;
    const pages = getPages(c.docId);
    let source = (Array.isArray(pages) && pages[page]) ? pages[page] : (c.text || "");
    if (!source) continue;

    // najdi nejbližší výskyt dotazového slova
    let pos = -1;
    if (main) pos = source.toLowerCase().indexOf(main);
    if (pos < 0) pos = Math.floor(source.length / 3);

    const half = Math.max(30, Math.floor(span / 2));
    const start = Math.max(0, pos - half);
    const end   = Math.min(source.length, pos + half);
    let excerpt = source.slice(start, end).replace(/\s+/g, " ").trim();
    if (start > 0) excerpt = "…" + excerpt;
    if (end < source.length) excerpt = excerpt + "…";

    const key = `${c.docId || "_"}:${page}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ docId: c.docId, page, excerpt });
  }

  return out;
}

/**
 * retrieveChunksForDoc – z RAM session vytáhne chunky a vrátí seřazené top N
 * @param {string} sessionId
 * @param {string} query
 * @param {object} opts { maxChunks?: number }
 * @returns Promise<Array<{docId, page, text, score}>>
 */
async function retrieveChunksForDoc(sessionId, query, opts = {}) {
  const maxChunks = opts.maxChunks ?? 8;
  if (!sessionId) return [];

  const doc = getSession(sessionId);
  if (!doc || !Array.isArray(doc.chunks) || !doc.chunks.length) {
    return [];
  }

  const ranked = rankBM25(query, doc.chunks);
  return ranked.slice(0, maxChunks).map(c => ({
    docId: sessionId,
    page: Number.isFinite(c.page)
      ? c.page
      : Number.isFinite(c.pageStart)
      ? c.pageStart
      : 0,
    text: c.text || "",
    score: typeof c.score === "number" ? c.score : 0
  }));
}

module.exports = {
  tokenize,
  rankBM25,
  pickExcerpts,
  retrieveChunksForDoc
};
