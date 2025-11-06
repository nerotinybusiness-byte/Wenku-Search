// Node 20+ (global fetch). OpenAI volitelně.
// RAG: BM25 + krátké citace po stránkách, multi-doc support (docIds=sessionIds).

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

// --- Helpers ------------------------------------------------------------------
const DOC_COLORS = ["#B3D334", "#C7EA46", "#9BD122", "#AADA2B", "#DFFF66", "#8FCF1A", "#7FD321"];
function hashColor(id = "") {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 131 + id.charCodeAt(i)) >>> 0;
  return DOC_COLORS[h % DOC_COLORS.length];
}
function interleaveByDoc(scored, limit = 6, perDocCap = 3) {
  const map = new Map();
  for (const c of scored) {
    if (!map.has(c.docId)) map.set(c.docId, []);
    if (map.get(c.docId).length < perDocCap) map.get(c.docId).push(c);
  }
  const buckets = [...map.values()];
  const out = [];
  let i = 0;
  while (out.length < limit) {
    let added = false;
    for (const b of buckets) {
      if (b[i]) { out.push(b[i]); added = true; if (out.length >= limit) break; }
    }
    if (!added) break;
    i++;
  }
  return out;
}

// --- GEMINI přes REST v1 (bez encodeURIComponent na PATH!) -------------------
async function askGemini({ prompt, model = "models/gemini-2.5-flash" }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const asked = model?.startsWith("models/")
    ? model
    : `models/${(model || "gemini-2.5-flash").replace(/^models\//, "")}`;

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
    generationConfig: { temperature: 0.1, topP: 0.9, maxOutputTokens: 1200 },
  };

  for (const m of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1/${m}:generateContent?key=${key}`;
    try {
      const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!resp.ok) { console.warn("[Gemini REST] fail", m, resp.status, await resp.text()); continue; }
      const json = await resp.json();
      const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
      if (text) return text;
      console.warn("[Gemini REST] empty text", m);
    } catch (e) { console.warn("[Gemini REST] error", m, e?.message || e); }
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

// --- Prompt builder -----------------------------------------------------------
function buildPrompt(q, topChunks) {
  // topChunks: [{docName, pageStart, text}, ...]
  const context = topChunks
    .map((c, i) => `[#${i + 1} | ${c.docName || "dokument"} | str. ${c.pageStart + 1}]\n${c.text}`)
    .join("\n\n-----\n\n");

  return (
`Jsi přesný asistent pro čtení dokumentů. Odpovídej POUZE z poskytnutého KONTEXTU.
Pokud odpověď v kontextu není, napiš jasně: "V poskytnutém kontextu se to nenachází." a navrhni, kde to v dokumentu hledat (strana/kapitola).

Požadavky:
- Čeština.
- Stručně, maximálně několik vět nebo odrážek.
- Žádné vymyšlené citace ani fakta mimo kontext.
- Ukaž odkazy na strany jako [str. X].

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
    const { sessionId, q, model, docIds } = req.body || {};
    if ((!sessionId && !Array.isArray(docIds)) || (Array.isArray(docIds) && docIds.length === 0)) {
      return res.status(400).json({ error: "Missing 'sessionId' or non-empty 'docIds'." });
    }
    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.status(400).json({ error: "Missing 'q' question'." });
    }

    // --- Seznam cílových dokumentů (default = single sessionId) --------------
    const targetIds = Array.isArray(docIds) && docIds.length ? docIds : [sessionId];

    // posbíráme sessiony a připravíme společný seznam chunků + pages map
    const allChunks = [];
    const pagesByDoc = {};
    const docMeta = {}; // docId -> {name}

    for (const id of targetIds) {
      const s = getSession(id);
      if (!s || !Array.isArray(s.chunks) || !Array.isArray(s.pages)) continue;
      pagesByDoc[id] = s.pages;
      docMeta[id] = { name: s.name || "document" };

      for (const c of s.chunks) {
        // obohatíme chunk o doc metadata (ponecháme terms/pageStart/text)
        allChunks.push({ ...c, docId: id, docName: s.name || "document" });
      }
    }

    if (!allChunks.length) {
      return res.status(404).json({ error: "No documents found. Upload and try again." });
    }

    // --- RAG výběr: BM25 -> interleaving -> citace ---------------------------
    const scored = rankBM25(q, allChunks);
    const topInterleaved = interleaveByDoc(scored, 6, 3); // limit kontextu
    const citationsRaw = pickExcerpts(q, topInterleaved, pagesByDoc); // multi-doc aware

    const citations = citationsRaw.map(x => ({
      docId: x.docId,
      docName: (docMeta[x.docId]?.name) || "document",
      page: (x.page ?? 0) + 1,
      excerpt: x.excerpt,
      color: hashColor(x.docId),
    }));

    const prompt = buildPrompt(q, topInterleaved);
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
      answer: "Nemám přístup k LLM (chybí GEMINI_API_KEY/OPENAI_API_KEY). Přidej klíč do ENV a zkus to znovu.",
      citations,
    });
  } catch (e) {
    console.error("ASK ERROR:", e);
    return res.status(500).json({ error: "LLM call failed." });
  }
}

module.exports = { handleAsk };
