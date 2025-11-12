// /api/ask.js
// Handler pro RAG dotaz s fallbackem na local/demo

let retrieveChunksForDoc = async () => [];
let renderAnswerHTML = undefined;
try {
  // Projektové utility – pokud nejsou, endpoint i tak odpoví
  const retr = require("../lib/retriever");
  if (typeof retr.retrieveChunksForDoc === "function") retrieveChunksForDoc = retr.retrieveChunksForDoc;
  if (typeof retr.renderAnswerHTML === "function") renderAnswerHTML = retr.renderAnswerHTML;
} catch (_) { /* ok – použijeme no-op fallbacky */ }

// ⬇️ tady je změna: bereme askWithModel z ./models, NE z ./core
const { askWithModel } = require("./models");

async function handleAsk(req, res) {
  try {
    const { sessionId, q, model } = req.body || {};
    if (!sessionId || !q) {
      return res.status(400).json({ error: "sessionId and q are required" });
    }

    // 1) Kandidátní chunky
    const ctx = (await retrieveChunksForDoc(sessionId, q)) || []; // [{page, text, score}, ...]

    // 2) Volání modelu přes abstrakci
    const using = model || process.env.WENKU_MODEL || "local";
    let answer = `Model: ${using}. (Demo odpověď)`;
    try {
      if (typeof askWithModel === "function") {
        answer = await askWithModel(using, q, ctx);
      }
    } catch (err) {
      console.error("ASK MODEL ERROR:", err?.message || err);
      // tichý fallback na demo string
    }

    // 3) Citace (top 3)
    const citations = ctx.slice(0, 3).map(c => ({
      docId: sessionId,
      page: Number.isFinite(c?.page) ? c.page : 1,
      excerpt: (c?.text || "").slice(0, 240)
    }));

    // 4) HTML varianta (pokud existuje utilita)
    const answer_html = typeof renderAnswerHTML === "function"
      ? renderAnswerHTML(answer, citations)
      : undefined;

    return res.json({ answer, answer_html, citations });
  } catch (err) {
    console.error("ASK ERROR:", err);
    return res.status(500).json({ error: "ASK_FAILED", detail: String(err?.message || err) });
  }
}

module.exports = { handleAsk };
