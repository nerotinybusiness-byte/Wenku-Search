// api/settings.js
function handleSettings(_req, res) {
  res.json({
    ok: true,
    model: process.env.WENKU_MODEL || "local",
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY
  });
}
module.exports = { handleSettings };
