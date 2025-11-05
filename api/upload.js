// api/upload.js
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { ensureSession, putSession } from "../lib/store.js";
import { chunkPages } from "../lib/chunker.js";

export const config = { api: { bodyParser: false } }; // potřebujeme multipart

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const form = formidable({ multiples: false, keepExtensions: true });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    const file = files?.file;
    if (!file) {
      res.status(400).json({ error: "Soubor chybí (pole 'file')." });
      return;
    }

    const ext = path.extname(file.originalFilename || file.newFilename || "").toLowerCase();
    const buf = fs.readFileSync(file.filepath);

    /** Extract text + page map */
    let pageTexts = [];
    if (ext === ".pdf") {
      const data = await pdfParse(buf);
      // pdf-parse neumí přesné stránkování s výňatky, ale vrací text; nicméně vrací i metadata s stránkami.
      // Pro citace po stránkách použijeme fallback: rozdělíme podle form-feed/patternu \n\n(?=Page|Strana)? – ale robustněji chunkneme na "pseudo-strany" podle počtu stránek,
      // pokud je k dispozici data.numpages.
      const total = data.numpages || 1;
      if (total > 1) {
        const lines = data.text.split(/\n/);
        const perPage = Math.ceil(lines.length / total);
        for (let i = 0; i < total; i++) {
          pageTexts.push(lines.slice(i * perPage, (i + 1) * perPage).join("\n").trim());
        }
      } else {
        pageTexts = [data.text.trim()];
      }
    } else if (ext === ".docx") {
      const r = await mammoth.extractRawText({ buffer: buf });
      const text = r.value || "";
      // DOCX nemá nativní stránky → simulace stran po ~1200 znakách (pro citace dostačující)
      const size = 1200;
      for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
      if (pageTexts.length === 0) pageTexts = [text];
    } else if (ext === ".txt" || ext === ".md") {
      const text = buf.toString("utf8");
      // Simulace stran po ~1500 znakách
      const size = 1500;
      for (let i = 0; i < text.length; i += size) pageTexts.push(text.slice(i, i + size));
      if (pageTexts.length === 0) pageTexts = [text];
    } else {
      res.status(415).json({ error: `Nepodporovaný typ: ${ext || "neznámý"}. Podporováno: PDF, DOCX, TXT, MD.` });
      return;
    }

    // Vytvoř session + chunky
    const session = ensureSession();
    const { chunks } = chunkPages(pageTexts, { targetTokens: 1200, overlapChars: 200 });

    putSession(session.id, {
      createdAt: Date.now(),
      pages: pageTexts,
      chunks, // [{id, pageStart, pageEnd, text, terms}]
    });

    res.json({ sessionId: session.id, pages: pageTexts.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload selhal." });
  }
}
