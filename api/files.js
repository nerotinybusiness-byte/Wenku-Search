// api/files.js
const fs = require("fs");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const HAVE_R2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_ENDPOINT &&
  !!process.env.R2_BUCKET;

let s3 = null;
if (HAVE_R2) {
  s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}
const BUCKET = process.env.R2_BUCKET || "";

/* ===== Disk fallback (dev) ===== */
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* ===== Helpers ===== */
function r2Key(sessionId, ext) {
  return `uploads/${sessionId}${ext || ""}`;
}

async function saveOriginal(buffer, { sessionId, ext, mime }) {
  if (HAVE_R2) {
    const Key = r2Key(sessionId, ext);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: buffer,
        ContentType: mime || "application/octet-stream",
      })
    );
    return { storage: "r2", key: Key, size: buffer.length };
  } else {
    ensureUploadsDir();
    const filePath = path.join(UPLOAD_DIR, `${sessionId}${ext || ""}`);
    fs.writeFileSync(filePath, buffer);
    return { storage: "disk", path: filePath, size: buffer.length };
  }
}

async function headR2(Key) {
  const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key }));
  return {
    size: Number(h.ContentLength || 0),
    etag: h.ETag,
    contentType: h.ContentType || "application/pdf",
  };
}

async function getR2Stream(Key, rangeHeader) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key,
    Range: rangeHeader, // např. "bytes=0-1023"
  });
  const r = await s3.send(cmd);
  return {
    body: r.Body, // stream
    contentRange: r.ContentRange || null,
    size: Number(r.ContentLength || 0),
    contentType: r.ContentType || "application/pdf",
    etag: r.ETag,
  };
}

module.exports = {
  HAVE_R2,
  s3,
  BUCKET,
  UPLOAD_DIR,
  ensureUploadsDir,
  r2Key,
  saveOriginal,
  headR2,
  getR2Stream,
};
