// api/models.js
// Jednotná abstrakce pro dotazy na různé modely (Gemini / OpenAI / local)

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const WENKU_MODEL = process.env.WENKU_MODEL || "local";
const DEBUG_CTX = process.env.WENKU_DEBUG_CTX === "1";

// Node 18+ má global fetch; v Node 22 (Render) je k dispozici.
if (typeof fetch !== "function") {
  throw new Error("Global fetch is not available – use Node 18+ / 20+ / 22+.");
}

/**
 * Najde rozumný výřez textu okolo slov z otázky.
 * - question: původní dotaz ("kde je sklad wenku?")
 * - text: celý text chunku (může být klidně celá stránka PDF)
 * - span: cílová délka výřezu (znaky)
 */
function makeSnippet(question, text, span = 800) {
  if (!text) return "";

  const qTerms = String(question || "")
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean);

  const lowerText = text.toLowerCase();
  let pos = -1;

  // hledej první výskyt některého slova z dotazu
  for (const t of qTerms) {
    const p = lowerText.indexOf(t);
    if (p >= 0 && (pos === -1 || p < pos)) {
      pos = p;
    }
  }

  const len = text.length;

  // nic nenalezeno → vezmi střed textu
  if (pos < 0) {
    if (len <= span) {
      return text.replace(/\s+/g, " ").trim();
    }
    const startMid = Math.max(0, Math.floor((len - span) / 2));
    const endMid = Math.min(len, startMid + span);
    let s = text.slice(startMid, endMid).replace(/\s+/g, " ").trim();
    if (startMid > 0) s = "…" + s;
    if (endMid < len) s = s + "…";
    return s;
  }

  // nalezeno → vezmi okno okolo pozice
  const half = Math.floor(span / 2);
  let start = Math.max(0, pos - half);
  let end = Math.min(len, pos + half);

  // dorovnej délku, pokud to jde
  if (end - start < span && len >= span) {
    const missing = span - (end - start);
    start = Math.max(0, start - Math.floor(missing / 2));
    end = Math.min(len, start + span);
  }

  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < len) snippet = snippet + "…";
  return snippet;
}

/**
 * Vygeneruje prompt pro QA nad dokumentem.
 * ctx = [{ page, text, score }, ...]
 */
function buildPrompt(question, ctx) {
  const contextText = (ctx || [])
    .slice(0, 6)
    .map((c, idx) => {
      const page = Number.isFinite(c.page) ? c.page : "?";
      const snippet = makeSnippet(question, c.text || "", 800);

      if (DEBUG_CTX) {
        const score = typeof c.score === "number" ? c.score.toFixed(4) : "?";
        console.log(
          `[CTX#${idx + 1}] page=${page} score=${score} :: ${snippet.slice(0, 200)}`
        );
      }

      return `[#${idx + 1}, page ${page}] ${snippet}`;
    })
    .join("\n\n");

  if (DEBUG_CTX && (!ctx || !ctx.length)) {
    console.log("[CTX] žádné chunky pro dotaz:", question);
  }

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
    "- If the context contains a postal address or a specific location that answers the question, include it in your answer.",
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
    .map(c => Number.isFinite(c.page) ? c.page : null)
    .filter(p => p !== null);
  const pageInfo = pages.length ? ` (context pages: ${[...new Set(pages)].join(", ")})` : "";
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
  const text = (choice && choice.message && choice.message.content) || "OpenAI returned no text.";
  return text.trim();
}

module.exports = {
  askWithModel
};
