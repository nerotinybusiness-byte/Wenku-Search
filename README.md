# Wenku – AI Document Reader (MVP)

- **Cíle**: odpovědi pouze z dokumentu + přesné citace (strana + excerpt).
- **Režimy**: `WENKU_MODEL=local` (bez LLM), `gemini-1.5-flash`, `gpt-4o-mini`.
- **Endpointy**:
  - `POST /api/upload` → `{sessionId,pages}`
  - `POST /api/ask` → `{answer,citations:[{page,excerpt}]}`
  - `GET  /api/settings`

## ENV
- `WENKU_MODEL=local|gemini-1.5-flash|gpt-4o-mini`
- `GEMINI_API_KEY=...` (pokud používáš Gemini)
- `OPENAI_API_KEY=...` (pokud používáš OpenAI)

## Nasazení na Vercel
1. Import repozitáře (Framework **Other**).
2. Project → Settings → Functions → Node 20.x.
3. Project → Settings → Environment Variables:
   - `WENKU_MODEL=local` (nebo `gemini-1.5-flash` / `gpt-4o-mini`)
   - `GEMINI_API_KEY`/`OPENAI_API_KEY` dle volby.
4. Otevři `/` a `/api/settings` pro smoke test.

## Poznámky
- U DOCX/TXT/MD simulujeme "strany" po blocích znaků, aby citace měly stránkování i bez nativních stránek.
- U PDF primárně používáme `pdf-parse` + rozhoz textu po `numpages`.
- Storage je **in-memory** (process lifetime). Pro produkci přidej Redis/S3/Neon.
