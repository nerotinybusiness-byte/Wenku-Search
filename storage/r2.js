// api/storage/r2.js
// Cloudflare R2 přes S3 kompatibilní klient
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function endpoint() {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT;
  const acc = process.env.R2_ACCOUNT_ID;
  if (!acc) throw new Error("R2_ACCOUNT_ID missing");
  return `https://${acc}.r2.cloudflarestorage.com`;
}

function getClient() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("R2 credentials missing");
  return new S3Client({
    region: "auto",
    endpoint: endpoint(),
    credentials: { accessKeyId, secretAccessKey }
  });
}

const BUCKET = () => {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET missing");
  return b;
};

async function putObject(key, body, contentType) {
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream"
  }));
}

async function headObject(key) {
  const s3 = getClient();
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
}

async function presignGet(key, ttlSec = 3600) {
  const s3 = getClient();
  const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSec });
}

async function deleteObject(key) {
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

module.exports = { putObject, headObject, presignGet, deleteObject };
