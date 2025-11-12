// api/storage/r2.js
const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const endpoint = process.env.R2_ENDPOINT;                 // https://<accountid>.r2.cloudflarestorage.com
const bucket   = process.env.R2_BUCKET;
const accessKeyId     = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.warn("[r2] Missing required env vars (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
}

const s3 = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return { key };
}
async function presignGet(key, expiresIn = 3600) {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
  return url;
}
async function headObject(key) {
  try { return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); }
  catch (e) { if (e.$metadata?.httpStatusCode === 404) return null; throw e; }
}
async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = { putObject, presignGet, headObject, deleteObject, bucket };
