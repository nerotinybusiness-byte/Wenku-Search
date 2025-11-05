// api/settings.js
export default function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  res.json({
    model: process.env.WENKU_MODEL || "local",
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ok: true
  });
}
