// add: const { getSession } = require("../lib/store");

function toSlugBase(name) {
  return String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}
function findCoreBySlug(slug) {
  const files = fs.readdirSync(CORE_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
  for (const f of files) if (toSlugBase(f) === slug) return path.join(CORE_DIR, f);
  return null;
}

app.get("/api/file/:id", (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.id || "");
    let filePath = null;

    // 1) přímé sessionId (user i core)
    const s = getSession(raw);
    if (s?.filePath && fs.existsSync(s.filePath)) filePath = s.filePath;

    // 2) fallback: slug → core soubor
    if (!filePath) filePath = findCoreBySlug(raw.replace(/^core_/, ""));

    if (!filePath) return res.status(404).json({ error: "File not found" });

    const stat = fs.statSync(filePath);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lm = new Date(stat.mtimeMs).toUTCString();

    if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", lm);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const total = stat.size;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${total}`); return res.end(); }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end   = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= total) {
        res.statusCode = 416; res.setHeader("Content-Range", `bytes */${total}`); return res.end();
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.setHeader("Content-Length", String(total));
    return fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error("file stream error:", e);
    res.status(500).json({ error: "file stream failed" });
  }
});
