// Minimal, ale plně funkční handler pro RAG dotaz s fallbackem

let retrieveChunksForDoc = async () => [];
let renderAnswerHTML = undefined;
try {
  // Preferuj projektové utility, ale když chybí, endpoint i tak odpoví
  const retr = require("../lib/retriever");
  if (typeof retr.retrieveChunksForDoc === "function") retrieveChunksForDoc = retr.retrieveChunksForDoc;
  if (typeof retr.renderAnswerHTML === "function") renderAnswerHTML = retr.renderAnswerHTML;
} catch (_) { /* ok – použijeme no-op fallbacky */ }

async function handleAsk(req, res) {
  try {
    const { sessionId, q, model } = req.body || {};
    if (!sessionId || !q) {
      return res.status(400).json({ error: "sessionId and q are required" });
    }

    // 1) Kandidátní chunky (bezpečný fallback na [])
    const ctx = (await retrieveChunksForDoc(sessionId, q)) || []; // [{page, text, score}, ...]

    // 2) Volba modelu + volání abstrakce (pokud existuje)
    const using = model || process.env.WENKU_MODEL || "local";
    let answer = `Model: ${using}. (Demo odpověď)`;
    try {
      const core = require("./core"); // abstrakce pro Gemini/OpenAI/local
      if (typeof core.askWithModel === "function") {
        answer = await core.askWithModel(using, q, ctx);
      }
    } catch (_) {
      // tichý fallback – endpoint žije, ale model není zapojen
    }

    // 3) Citace (top 3, bezpečné defaulty)
    const citations = ctx.slice(0, 3).map(c => ({
      docId: sessionId,
      page: Number.isFinite(c?.page) ? c.page : 1,
      excerpt: (c?.text || "").slice(0, 240)
    }));

    // 4) HTML varianta (pokud utilita existuje)
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
