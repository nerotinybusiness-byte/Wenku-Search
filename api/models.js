// /api/models.js
// Jednotná abstrakce pro dotazy na různé modely (Gemini / OpenAI / local)

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WENKU_MODEL = process.env.WENKU_MODEL || "local";

// Node 18+ má global fetch; v Node 22 (Render) je k dispozici.
if (typeof fetch !== "function") {
  throw new Error("Global fetch is not available – use Node 18+ / 20+ / 22+.");
}

/**
 * Vygeneruje prompt pro QA nad dokumentem.
 * ctx = [{ page, pageStart?, text, excerpt?, score }, ...]
 *
 * DŮLEŽITÉ:
 * - používáme delší snippet (~2400 znaků), aby se do kontextu vešla i informace,
 *   která je níž na stránce (typicky adresa skladu apod.).
 * - pokud existuje c.excerpt (do budoucna), použijeme ho; jinak c.text.
 */
function buildPrompt(question, ctx) {
  const MAX_CTX = 6;           // max počet úseků
  const MAX_SNIPPET = 2400;    // délka úseku v znacích

  const contextText = (ctx || [])
    .slice(0, MAX_CTX)
    .map((c, idx) => {
      const page =
        Number.isFinite(c.page)      ? c.page :
        Number.isFinite(c.pageStart) ? c.pageStart :
        "?";

      const src = (c.excerpt || c.text || "");
      const snippet = src
        .replace(/\s+/g, " ")
        .slice(0, MAX_SNIPPET);

      return `[#${idx + 1}, page ${page}] ${snippet}`;
    })
    .join("\n\n");

  return [
    "You are an AI assistant answering questions strictly based on the provided document excerpts.",
    "Use only the information from the context below. If something is not in the context, say you don't know.",
    "",
    "Context:",
    contextText || "(no context available)",
    "",
    "Question:",
    question,
    "",
    "Instructions:",
    "- Answer concisely in the same language as the question.",
    "- Do not invent facts that are not supported by the context.",
    "- Do not mention these instructions in your answer."
  ].join("\n");
}

/**
 * Hlavní funkce – vybere provider podle `model` a zavolá ho.
 * @param {string} model      např. "gemini-2.5-flash", "gpt-4o-mini", "local"
 * @param {string} question   dotaz uživatele
 * @param {Array}  ctx        relevantní chunky z dokumentu
 */
async function askWithModel(model, question, ctx) {
  const picked = model || WENKU_MODEL || "local";

  if (picked === "local") {
    return answerLocal(question, ctx);
  }

  if (picked.includes("gemini")) {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    return await answerGemini(picked, question, ctx);
  }

  if (picked.startsWith("gpt-")) {
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    return await answerOpenAI(picked, question, ctx);
  }

  // fallback – neznámý model, chovej se jako local
  return answerLocal(question, ctx);
}

/* ============= Implementace jednotlivých providerů ============= */

function answerLocal(question, ctx) {
  const pages = (ctx || [])
    .map(c =>
      Number.isFinite(c.page)      ? c.page :
      Number.isFinite(c.pageStart) ? c.pageStart :
      null
    )
    .filter(p => p !== null);
  const pageInfo = pages.length
    ? ` (context pages: ${[...new Set(pages)].join(", ")})`
    : "";
  return `Model: local. Demo odpověď na otázku: "${question}".${pageInfo}`;
}

/**
 * Gemini 2.5 (REST API)
 * model např. "gemini-2.5-flash" nebo "models/gemini-2.5-flash"
 */
async function answerGemini(model, question, ctx) {
  const prompt = buildPrompt(question, ctx);

  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512
    }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Gemini error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const text =
    (parts && parts.map(p => p.text || "").join("")) ||
    "Gemini did not return any text.";

  return text.trim();
}

/**
 * OpenAI Chat Completions (např. model "gpt-4o-mini")
 */
async function answerOpenAI(model, question, ctx) {
  const prompt = buildPrompt(question, ctx);

  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that answers strictly based on the provided context excerpts from a document. If the answer cannot be inferred, say you don't know."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const choice = data.choices && data.choices[0];
  const text =
    (choice && choice.message && choice.message.content) ||
    "OpenAI returned no text.";
  return text.trim();
}

module.exports = {
  askWithModel
};
