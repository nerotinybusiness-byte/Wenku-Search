// api/ask.js
const OpenAI = require("openai");
const { getSession } = require("../lib/store");
const { rankBM25, pickExcerpts } = require("../lib/retriever");

// -------- Provider volba ----------------------------------------------------
function llmProvider(model) {
  const useGemini = process.env.GEMINI_API_KEY && (!model || model.startsWith("models/gemini"));
  const useOpenAI = process.env.OPENAI_API_KEY && model && model.startsWith("gpt");
  if (useGemini) return "gemini";
  if (useOpenAI) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "local";
}

// -------- Gemini (REST v1) ---------------------------------------------------
async function askGemini({ prompt, model = "models/gemini-2.5-flash" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  // z UI může přijít bez prefixu
  const asked = (model || "models/gemini-2.5-flash").replace(/^models\//, "");
  const candidates = asked.includes("2.5")
    ? [
        `models/${asked}`,
        "models/gemini-2.5-flash",
        "models/gemini-2.5-pro",
        "models/gemini-2.0-flash",
        "models/gemini-2.0-flash-001",
        "models/gemini-2.5-flash-lite",
      ]
    : [
        `models/${asked}`,
        "models/gemini-2.0-flash",
        "models/gemini-2.0-flash-001",
        "models/gemini-2.5-flash",
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
    const url = `https://generativelanguage.googleapis.com/v1/${encodeURIComponent(
      m
    )}:generateContent?key=${key}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        // pro ladění necháváme tichou fallback logiku
        continue;
      }
      const json = await resp.json();
      const text =
        json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
      if (text) return text;
    } catch {
      // zkus další kandidát
    }
  }
  throw new Error("All Gemini REST candidates failed");
}

// -------- OpenAI -------------------------------------------------------------
async function askOpenAI({ prompt, model = "gpt-4o-mini" }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 900,
  });
  return res.choices?.[0]?.message?.content ?? "";
}

// -------- Utility pro lepší RAG ---------------------------------------------
function countHits(query, text) {
  const q = (query.toLowerCase().match(/[a-zá-ž0-9]+/gi) || []).filter((t) => t.length > 2);
  const t = text.toLowerCase();
  let hits = 0;
  for (const term of q) if (t.includes(term)) hits++;
  return hits;
}

function compress(text, maxChars = 1600) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  // vyber střed + začátek — aby se zachytily definice i detail
  const head = text.slice(0, Math.floor(maxChars * 0.35));
  const middleStart = Math.max(0, Math.floor((text.length - maxChars * 0.3) / 2));
  const middle = text.slice(middleStart, middleStart + Math.floor(maxChars * 0.3));
  const tail = text.slice(-Math.floor(maxChars * 0.35));
  return `${head}\n…\n${middle}\n…\n${tail}`;
}

function selectTopContext(query, rankedChunks, limit = 4) {
  // seřazeno už máme; filtrujeme na skutečné shody a zkrátíme
  const picked = [];
  for (const c of rankedChunks) {
    const hits = countHits(query, c.text);
    if (hits >= 2) picked.push({ ...c, hits });
    if (picked.length >= limit) break;
  }
  return picked;
}

function buildPrompt(q, chunks) {
  const context = chunks
    .map(
      (c, i) =>
        `[#${i + 1} | strana ${c.pageStart + 1}]\n${compress(c.text, 1400)}`
    )
    .join("\n\n-----\n\n");

  return (
    `Jsi velmi stručný a přesný asistent ve **češtině**.\n` +
    `Odpovídej **výhradně** z poskytnutého KONTEKSTU níže. Neopisuj dlouhé pasáže, napiš jen to podstatné.\n` +
    `Pokud chybí informace, napiš větu: "V poskytnutém kontextu to není. Doporučuji projít další části dokumentu." a nic si nedovymýšlej.\n\n` +
    `Formát odpovědi:\n` +
    `- 3–8 stručných bodů (max. 1–2 věty každý)\n` +
    `- jasné názvy bodů tučně (např. **Zodpovědnost:** …)\n` +
    `- vynech omáčku, žádné úvody ani závěry\n\n` +
    `OTÁZKA:\n${q}\n\n` +
    `KONTEKST:\n${context}\n`
  );
}

// -------- Hlavní handler -----------------------------------------------------
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

    // Rank + výběr top chunků se skutečnými shodami
    const ranked = rankBM25(q, session.chunks);
    const topChunks = selectTopContext(q, ranked, 4);

    // Pokud nic relevantního, neplať LLM a vrať rozumný fallback
    if (topChunks.length === 0) {
      return res.json({
        answer:
          "V poskytnutém kontextu to není. Doporučuji projít další části dokumentu nebo zkusit upřesnit dotaz.",
        citations: [],
      });
    }

    const citations = pickExcerpts(q, ranked, session.pages).map((x) => ({
      page: (x.page ?? 0) + 1,
      excerpt: x.excerpt,
    }));

    const prompt = buildPrompt(q, topChunks);
    const provider = llmProvider(model);

    let answer;
    if (provider === "gemini") {
      // UI může posílat např. "gemini-2.5-flash" → doplníme prefix
      const m = model?.startsWith("models/") ? model : model ? `models/${model}` : undefined;
      answer = await askGemini({ prompt, model: m });
    } else if (provider === "openai") {
      answer = await askOpenAI({ prompt, model });
    } else {
      answer =
        "Nemám přístup k LLM (chybí GEMINI_API_KEY/OPENAI_API_KEY). Přidej klíč do ENV, nebo přepni model v Nastavení.";
    }

    // drobný postprocess – ořez dlouhých odpovědí
    if (answer && answer.length > 4000) answer = answer.slice(0, 4000) + " …";

    return res.json({ answer, citations });
  } catch (e) {
    console.error("ASK ERROR:", e);
    res.status(500).json({ error: "LLM call failed." });
  }
}

module.exports = { handleAsk };
