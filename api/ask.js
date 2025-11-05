// api/ask.js
import { getSession } from "../lib/store.js";
import { rankBM25, pickExcerpts } from "../lib/retriever.js";

const SYS_PROMPT = `Jsi vyhledávač odpovědí z dodaného dokumentu.
Odpovídej pouze z pasáží, které ti pošlu. Když informace v pasážích nejsou, řekni stručně česky: "V dokumentu k tomu nejsou informace."
Odpovědi dávej stručně (2–5 vět), věcně, bez omáčky. Na konec vracej JSON "citations":[{page,excerpt}].`;

async function callLLM({ provider, model, apiKey, question, context }) {
  // "Local" režim: extraktivní shrnutí bez volání LLM – minimalizuje halucinace
  if (provider === "local" || !apiKey) {
    // Vezmeme první 2–3 pasáže a uděláme jednoduchý heuristický "extrakt"
    const top = context.slice(0, 3).map(c => c.text).join("\n\n");
    // Zjednodušené: vrátíme nejvýstižnější věty (split tečky, vyber prvních 3–5, které obsahují slova z dotazu)
    const terms = question.toLowerCase().split(/\W+/).filter(Boolean);
    const sentences = top.split(/(?<=[\.\?\!])\s+/).filter(s => s.trim().length > 0);
    const scored = sentences
      .map(s => {
        const l = s.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (l.includes(t) ? 1 : 0), 0) + Math.min(s.length / 200, 1);
        return { s: s.trim(), score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(o => o.s);
    return scored.length ? scored.join(" ") : "V dokumentu k tomu nejsou informace.";
  }

  if (provider === "openai") {
    const body = {
      model: model || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: `Otázka: ${question}\n\nPasáže:\n${context.map((c, i) => `#${i+1} [str. ${c.pageStart+1}-${c.pageEnd+1}]\n${c.text}`).join("\n\n")}` }
      ],
      temperature: 0.1
    };
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || "V dokumentu k tomu nejsou informace.";
  }

  if (provider === "gemini") {
    const gbody = {
      contents: [{
        role: "user",
        parts: [{ text: `${SYS_PROMPT}\n\nOtázka: ${question}\n\nPasáže:\n${context.map((c, i) => `#${i+1} [str. ${c.pageStart+1}-${c.pageEnd+1}]\n${c.text}`).join("\n\n")}` }]
      }],
      generationConfig: { temperature: 0.1 }
    };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gbody)
    });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("").trim() || "V dokumentu k tomu nejsou informace.";
  }

  return "V dokumentu k tomu nejsou informace.";
}

function parseCitationsFromLLM(text, fallbackCites) {
  // Očekáváme, že LLM nic nevymýšlí; i tak se radši opřeme o retriever
  // Vynutíme citace z fallbacku (top pasáže), ale respektujeme požadavek: 1-based page + excerpt <= ~200 znaků
  return fallbackCites;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }
  try {
    const { sessionId, q } = await parseJson(req);
    if (!sessionId || !q) {
      res.status(400).json({ error: "Chybí sessionId nebo q." }); return;
    }
    const s = getSession(sessionId);
    if (!s) { res.status(404).json({ error: "Session nenalezena." }); return; }

    // BM25 ranking
    const ranked = rankBM25(q, s.chunks).slice(0, 5);
    const excerpts = pickExcerpts(q, ranked, s.pages);

    // LLM
    const provider = process.env.WENKU_MODEL?.startsWith("gemini") ? "gemini"
                   : process.env.WENKU_MODEL?.startsWith("gpt") ? "openai"
                   : (process.env.WENKU_MODEL === "local" || !process.env.WENKU_MODEL) ? "local" : "local";

    const apiKey = provider === "gemini" ? process.env.GEMINI_API_KEY
                : provider === "openai" ? process.env.OPENAI_API_KEY
                : undefined;

    const answer = await callLLM({
      provider,
      model: process.env.WENKU_MODEL || "local",
      apiKey,
      question: q,
      context: ranked
    });

    // Citace (vždy 1-based page + krátký výňatek)
    const citations = excerpts.map(e => ({ page: e.page + 1, excerpt: e.excerpt }));

    res.json({ answer, citations });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Dotaz selhal." });
  }
}

async function parseJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}
