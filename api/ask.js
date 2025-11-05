// api/ask.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const { getSession } = require("../lib/store");
const { rankBM25, pickExcerpts } = require("../lib/retriever");

// Rozhodnutí o provideru podle modelu a dostupných klíčů
function llmProvider(model) {
  const useGemini = process.env.GEMINI_API_KEY && (!model || model.startsWith("gemini"));
  const useOpenAI = process.env.OPENAI_API_KEY && model && model.startsWith("gpt");
  if (useGemini) return "gemini";
  if (useOpenAI) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "local";
}

// GEMINI (API v1 + fallbacky názvů)
async function askGemini({ prompt, model = "gemini-1.5-flash-latest" }) {
  // normalize: bez 'models/' prefixu
  const name = (model || "gemini-1.5-flash-latest").replace(/^models\//, "");

  // vynutíme API v1 (u starších buildů jinak padá na v1beta)
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY, { apiVersion: "v1" });

  // primární pokus
  try {
    const m = genAI.getGenerativeModel({ model: name });
    const res = await m.generateContent(prompt); // posíláme string
    return res.response.text();
  } catch (e) {
    // fallbacky podle variant, které jsou typicky povolené
    const alternates = name.includes("flash")
      ? ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-flash-8b"]
      : ["gemini-1.5-pro", "gemini-1.5-pro-001", "gemini-1.5-pro-latest"];
    for (const alt of alternates) {
      try {
        const m2 = genAI.getGenerativeModel({ model: alt });
        const r2 = await m2.generateContent(prompt);
        return r2.response.text();
      } catch {}
    }
    throw e;
  }
}

// OPENAI
async function askOpenAI({ prompt, model = "gpt-4o-mini" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });
  return res.choices?.[0]?.message?.content ?? "";
}

// Prompt pro RAG
function buildPrompt(q, topChunks) {
  const context = topChunks
    .map((c, i) => `[#${i + 1} | page ${c.pageStart + 1}]\n${c.text}`)
    .join("\n\n-----\n\n");

  return `You are a precise assistant. Answer strictly from CONTEXT. If information is missing, say you don't know and suggest where to look in the document.

QUESTION:
${q}

CONTEXT:
${context}

Answer in Czech, concise, with bullet points if helpful.`;
}

// Hlavní handler
async function handleAsk(req, res) {
  try {
    const { sessionId, q, model } = req.body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Missing 'sessionId'." });
    }
    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.status(400).json({ error: "Missing 'q' question." });
    }

    const session = getSession(sessionId);
    if (!session || !Array.isArray(session.chunks) || !Array.isArray(session.pages)) {
      return res.status(404).json({ error: "Session not found. Upload a document first." });
    }

    // RAG – BM25, výběr top chunků + citace
    const ranked = rankBM25(q, session.chunks);
    const topChunks = ranked.slice(0, 5);
    const citations = pickExcerpts(q, ranked, session.pages).map(x => ({
      page: (x.page ?? 0) + 1, // 1-based pro UI
      excerpt: x.excerpt
    }));

    const prompt = buildPrompt(q, topChunks);
    const provider = llmProvider(model);

    if (provider === "gemini") {
      const answer = await askGemini({ prompt, model });
      return res.json({ answer, citations });
    }
    if (provider === "openai") {
      const answer = await askOpenAI({ prompt, model });
      return res.json({ answer, citations });
    }

    // fallback local (bez LLM)
    return res.json({
      answer: "Nemám přístup k LLM (chybí GEMINI_API_KEY/OPENAI_API_KEY). Přidej klíč do ENV.",
      citations
    });
  } catch (e) {
    console.error("ASK ERROR:", e);
    res.status(500).json({ error: "LLM call failed." });
  }
}

module.exports = { handleAsk };
