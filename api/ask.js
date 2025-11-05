// api/ask.js
const { GoogleGenerativeAI } = require("@google/generative-ai"); // jen kvůli typům; voláme REST
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

/**
 * GEMINI přes REST v1 (obejití v1beta bugů SDK)
 * - normalizace názvu modelu
 * - fallbacky (flash/pro varianty)
 * - dual-path (v1/models/<id>:... i v1/models/<name> s prefixem)
 */
async function askGemini({ prompt, model = "gemini-1.5-flash-latest" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const base = (model || "gemini-1.5-flash-latest").replace(/^models\//, "");
  const bases = base.includes("flash")
    ? [base, "gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-flash-8b"]
    : [base, "gemini-1.5-pro", "gemini-1.5-pro-001", "gemini-1.5-pro-latest"];

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  for (const id of bases) {
    const tries = [
      // A) bez prefixu v cestě
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(id)}:generateContent?key=${key}`,
      // B) s prefixem "models/" v názvu
      `https://generativelanguage.googleapis.com/v1/${encodeURIComponent("models/" + id)}:generateContent?key=${key}`,
    ];
    for (const url of tries) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const t = await resp.text();
          console.warn("[Gemini REST] fail", url, resp.status, resp.statusText, t.slice(0, 180));
          continue;
        }
        const json = await resp.json();
        const text =
          json.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("")?.trim() || "";
        if (text) return text;
        console.warn("[Gemini REST] empty text", url, JSON.stringify(json).slice(0, 200));
      } catch (e) {
        console.warn("[Gemini REST] error", url, e?.message || e);
      }
    }
  }
  throw new Error("All Gemini REST candidates failed");
}

// OPENAI
async function askOpenAI({ prompt, model = "gpt-4o-mini" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
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
      excerpt: x.excerpt,
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
      citations,
    });
  } catch (e) {
    console.error("ASK ERROR:", e);
    res.status(500).json({ error: "LLM call failed." });
  }
}

module.exports = { handleAsk };
