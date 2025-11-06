function tokenize(q) {
  return (q.toLowerCase().match(/[a-zá-ž0-9]+/gi) || []);
}

function rankBM25(query, chunks) {
  const terms = tokenize(query);
  const N = chunks.length || 1;
  const avgdl = chunks.reduce((a, c) => a + (c.terms?.length || 0), 0) / N;
  const k1 = 1.5, b = 0.75;

  const df = {};
  for (const t of terms) df[t] = chunks.reduce((acc, c) => acc + ((c.terms || []).includes(t) ? 1 : 0), 0);

  const idf = {};
  for (const t of terms) {
    const dft = df[t] || 0;
    idf[t] = Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
  }

  const scored = chunks.map(c => {
    let score = 0;
    for (const t of terms) {
      const freq = (c.terms || []).filter(x => x === t).length;
      const denom = freq + k1 * (1 - b + b * ((c.terms?.length || 0) / (avgdl || 1)));
      score += idf[t] * ((freq * (k1 + 1)) / (denom || 1));
    }
    return { ...c, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * pickExcerpts – funguje pro single-doc i multi-doc.
 * @param query string
 * @param ranked [{docId, pageStart, text, ...}]
 * @param pagesRef map { docId: pages[] } NEBO pages[] (single-doc kompatibilita)
 */
function pickExcerpts(query, ranked, pagesRef) {
  const results = [];
  const qterm = (tokenize(query)[0] || "").slice(0, 32);

  const getPages = (docId) => {
    if (Array.isArray(pagesRef)) return pagesRef;        // zpětná kompatibilita
    return (pagesRef && pagesRef[docId]) || [];          // multi-doc
  };

  for (const c of ranked.slice(0, 8)) {
    const pages = getPages(c.docId);
    const pageIdx = c.pageStart ?? 0;
    const text = pages[pageIdx] || c.text || "";
    let i = qterm ? text.toLowerCase().indexOf(qterm) : -1;
    if (i < 0) i = Math.floor(text.length / 3);
    const start = Math.max(0, i - 100);
    const end = Math.min(text.length, start + 220);
    const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    results.push({ docId: c.docId, page: pageIdx, excerpt });
  }

  // dedup podle (docId,page)
  const seen = new Set();
  return results.filter(r => {
    const key = `${r.docId || "_"}:${r.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { rankBM25, pickExcerpts };
