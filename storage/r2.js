// api/storage/r2.js
// Cloudflare R2 (S3 kompatibilní) – upload, presign GET, delete
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } =
  require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const ACCOUNT_ID        = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET            = process.env.R2_BUCKET || "";
// např.: https://519499a56fa0db2c0529630ec3f4fde4.r2.cloudflarestorage.com
const ENDPOINT          = (process.env.R2_ENDPOINT || "").replace(/\/+$/,"");

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET || !ENDPOINT) {
  console.warn("[r2] Missing R2_* envs – R2 features will fail until set.");
}

const s3 = (ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && ENDPOINT)
  ? new S3Client({
      region: "auto",
      endpoint: ENDPOINT,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    })
  : null;

async function putObject(key, body, contentType = "application/octet-stream") {
  if (!s3) throw new Error("R2 not configured");
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { key };
}

async function deleteObject(key) {
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function presignGet(key, expiresSec = 3600) {
  if (!s3) throw new Error("R2 not configured");
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); } catch {}
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresSec });
  return url;
}

module.exports = { putObject, deleteObject, presignGet };
