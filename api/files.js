// api/files.js
// Jednoduchý fallback na lokální disk pro originální soubory (dev / bez R2)

const fs = require("fs");
const path = require("path");

// uploads/ vedle api/
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

module.exports = {
  UPLOAD_DIR,
  ensureUploadsDir,
};
