// api/ask.js
// Node 20+ (global fetch). OpenAI volitelně.
// RAG: BM25 + krátké citace po stránkách.

const OpenAI = require("openai");
const { getSession } = require("../lib/store");
const { rankBM25, pickExcerpts } = require("../lib/retriever");

// --- Provider switch ----------------------------------------------------------
function llmProvider(model) {
  const useGemini = process.env.GEMINI_API_KEY && (!model || model.startsWith("gemini"));
  const useOpenAI = process.env.OPENAI_API_KEY && model && model.startsWith("gpt");
  if (useGemini) return "gemini";
  if (useOpenAI) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "local";
}

// --- GEMINI přes REST v1 (bez encodeURIComponent na PATH!) -------------------
async function askGemini({ prompt, model = "models/gemini-2.5-flash" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  // normalizace názvu: UI může poslat "gemini-2.5-flash" i "models/gemini-2.5-flash"
  const asked = model?.startsWith("models/")
    ? model
    : `models/${(model || "gemini-2.5-flash").replace(/^models\//, "")}`;

  // kandidáti podle aktuálně zveřejněných modelů ListModels (v1)
  const candidates = [
    asked,
    "models/gemini-2.5-flash",
    "models/gemini-2.5-pro",
    "models/gemini-2.5-flash-lite",
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-001",
    "models/gemini-2.0-flash-lite",
  ];

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 1200,
    },
  };

  for (const m of candidates) {
    // ❗ PATH se NESMÍ kódovat; kóduje se jen query (=key)
    const url = `https://generativelanguage.googleapis.com/v1/${m}:generateContent?key=${key}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const msg = await resp.text();
        console.warn("[Gemini REST] fail", m, resp.status, resp.statusText, msg.slice(0, 200));
        continue;
      }

      const json = await resp.json();
      const text = json?.candidates?.[0]?.content?.parts
        ?.map(p => p.text || "")
        .join("")
        .trim();

      if (text) return text;
      console.warn("[Gemini REST] empty text", m);
    } catch (e) {
      console.warn("[Gemini REST] error", m, e?.message || e);
    }
  }

  throw new Error("All Gemini REST candidates failed");
}

// --- OPENAI -------------------------------------------------------------------
async function askOpenAI({ prompt, model = "gpt-4o-mini" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices?.[0]?.message?.content ?? "";
}

// --- Prompt builder (přísný kontext + stručné CZ výstupy) --------------------
function buildPrompt(q, topChunks) {
  const context = topChunks
    .map((c, i) => `[#${i + 1} | page ${c.pageStart + 1}]\n${c.text}`)
    .join("\n\n-----\n\n");

  return (
`Jsi přesný asistent pro čtení dokumentů. Odpovídej POUZE z poskytnutého KONTEXTU.
Pokud odpověď v kontextu není, napiš jasně: "V poskytnutém kontextu se to nenachází." a navrhni, kde to v dokumentu hledat (strana/kapitola).

Požadavky:
- Čeština.
- Stručně, maximálně několik vět nebo odrážek.
- Žádné vymyšlené citace ani fakta mimo kontext.
- Ukaž odkazy na strany jako [str. X] podle přiložených identifikátorů.

DOTAZ:
${q}

KONTEXT:
${context}

Odpověď:`
  );
}

// --- HTTP handler -------------------------------------------------------------
async function handleAsk(req, res) {
  try {
    const { sessionId, q, model } = req.body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Missing 'sessionId'." });
    }
    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.status(400).json({ error: "Missing 'q' question'." });
    }

    const session = getSession(sessionId);
    if (!session || !Array.isArray(session.chunks) || !Array.isArray(session.pages)) {
      return res.status(404).json({ error: "Session not found. Upload a document first." });
    }

    // RAG výběr: BM25 -> topChunks -> citace
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
      answer:
        "Nemám přístup k LLM (chybí GEMINI_API_KEY/OPENAI_API_KEY). Přidej klíč do ENV a zkus to znovu.",
      citations,
    });
  } catch (e) {
    console.error("ASK ERROR:", e);
    return res.status(500).json({ error: "LLM call failed." });
  }
}

module.exports = { handleAsk };
