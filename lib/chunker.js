// lib/chunker.js
import crypto from "crypto";

function tokenize(text) {
  return (text.toLowerCase().match(/[a-zá-ž0-9]+/gi) || []);
}

export function chunkPages(pageTexts, { targetTokens = 1200, overlapChars = 200 } = {}) {
  const chunks = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const page = pageTexts[i] || "";
    if (page.length <= targetTokens * 5) {
      chunks.push(makeChunk(page, i, i));
    } else {
      // sliding window po znacích
      const step = targetTokens * 5 - overlapChars;
      for (let off = 0; off < page.length; off += step) {
        const slice = page.slice(off, off + targetTokens * 5);
        chunks.push(makeChunk(slice, i, i));
      }
    }
  }
  return { chunks };
}

function makeChunk(text, pageStart, pageEnd) {
  const id = crypto.createHash("md5").update(text).digest("hex").slice(0, 10);
  const terms = tokenize(text);
  return { id, pageStart, pageEnd, text, terms };
}
