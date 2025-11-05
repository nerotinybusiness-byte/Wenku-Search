// lib/retriever.js
function tokenize(q) {
  return (q.toLowerCase().match(/[a-zá-ž0-9]+/gi) || []);
}

function rankBM25(query, chunks) {
  const terms = tokenize(query);
  const N = chunks.length || 1;
  const avgdl = chunks.reduce((a, c) => a + c.terms.length, 0) / N;
  const k1 = 1.5, b = 0.75;

  const df = {};
  for (const t of terms) {
    df[t] = chunks.reduce((acc, c) => acc + (c.terms.includes(t) ? 1 : 0), 0);
  }
  const idf = {};
  for (const t of terms) {
    const dft = df[t] || 0;
    idf[t] = Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
  }

  const scored = chunks.map(c => {
    let score = 0;
    for (const t of terms) {
      const freq = c.terms.filter(x => x === t).length;
      const denom = freq + k1 * (1 - b + b * (c.terms.length / avgdl));
      score += idf[t] * ((freq * (k1 + 1)) / (denom || 1));
    }
    return { ...c, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

function pickExcerpts(query, ranked, pages) {
  const results = [];
  const qterm = (tokenize(query)[0] || "").slice(0, 32);
  for (const c of ranked.slice(0, 5)) {
    const pageIdx = c.pageStart;
    const text = pages[pageIdx] || c.text || "";
    let i = qterm ? text.toLowerCase().indexOf(qterm) : -1;
    if (i < 0) i = Math.floor(text.length / 3);
    const start = Math.max(0, i - 100);
    const end = Math.min(text.length, start + 220);
    const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    results.push({ page: pageIdx, excerpt });
  }
  const seen = new Set();
  return results.filter(r => (seen.has(r.page) ? false : (seen.add(r.page), true)));
}

module.exports = { rankBM25, pickExcerpts };
