// api/ask.js
const OpenAI = require("openai");
const { getSession } = require("../lib/store");
const { rankBM25, pickExcerpts } = require("../lib/retriever");

// Rozhodnutí o provideru podle modelu a dostupných klíčů
function llmProvider(model) {
  // Akceptujeme "models/..." i bez prefixu
  const m = (model || "").toLowerCase();
  const isGemini = !m || m.includes("gemini");
  const isOpenAI = m.startsWith("gpt");

  const haveGemini = !!process.env.GEMINI_API_KEY;
  const haveOpenAI = !!process.env.OPENAI_API_KEY;

  if (isGemini && haveGemini) return "gemini";
  if (isOpenAI && haveOpenAI) return "openai";
  if (haveOpenAI) return "openai";
  if (haveGemini) return "gemini";
  return "local";
}

/**
 * GEMINI přes REST v1 – cílené na dostupné modely dle /api/models:
 *  - models/gemini-2.5-flash (default), fallbacky: 2.5-pro, 2.0-flash (+ varianty)
 *  - pro každý název zkoušíme 2 cesty: /v1/models/<id> i /v1/<models/id>
 */
async function askGemini({ prompt, model = "models/gemini-2.5-flash" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const asked = (model || "models/gemini-2.5-flash");
  const bases = [
    asked,
    "models/gemini-2.5-pro",
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-001",
    "models/gemini-2.0-flash-lite",
    "models/gemini-2.0-flash-lite-001",
    "models/gemini-2.5-flash-lite"
  ];

  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

  for (const name of bases) {
    const noPrefix = name.replace(/^models\//, "");
    const tries = [
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(noPrefix)}:generateContent?key=${key}`,
      `https://generativelanguage.googleapis.com/v1/${encodeURIComponent(name)}:generateContent?key=${key}`
    ];
    for (const url of tries) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          const t = await resp.text();
          console.warn("[Gemini REST] fail", url, resp.status, resp.statusText, t.slice(0, 180));
          continue;
        }
        const json = await resp.json();
        const text = json.candidates?.[0]?.content?.parts
          ?.map(p => p.text || "")
          .join("")
          ?.trim() || "";
        if (text) return text;
        console.warn("[Gemini REST] empty text", url, JSON.stringify(json).slice(0, 200));
      } catch (e) {
        console.warn("[Gemini REST] error", url, e?.message || e);
      }
    }
  }
  throw new Error("All Gemini REST candidates failed");
}

async function askOpenAI({ prompt, model = "gpt-4o-mini" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });
  return res.choices?.[0]?.message?.content ?? "";
}

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

    const ranked = rankBM25(q, session.chunks);
    const topChunks = ranked.slice(0, 5);
    const citations = pickExcerpts(q, ranked, session.pages).map(x => ({
      page: (x.page ?? 0) + 1,
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
