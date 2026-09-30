// Minimal S3 SigV4 query-string presigning for Railway Buckets (no SDK needed).
import crypto from "node:crypto";

const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Bucket settings from the Railway-provided variables, or null if not configured. */
export function bucketFromEnv(env = process.env) {
  const { BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY, ENDPOINT } = env;
  if (!BUCKET || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !ENDPOINT) return null;
  return {
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    endpoint: ENDPOINT,
    region: env.REGION || "auto",
  };
}

/** Returns a presigned virtual-hosted-style URL for `method` on `key`, valid for `expires` seconds. */
export function presign(cfg, key, { method = "GET", expires = 3600, query: extraQuery = {} } = {}) {
  const base = new URL(cfg.endpoint);
  const host = `${cfg.bucket}.${base.host}`;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = now.slice(0, 8);
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const path = "/" + key.split("/").map(enc).join("/");
  const params = {
    ...extraQuery,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": now,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join("&");
  const canonical = [method, path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256hex(canonical)].join("\n");
  const kDate = hmac("AWS4" + cfg.secretAccessKey, date);
  const kSigning = hmac(hmac(hmac(kDate, cfg.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
  return `${base.protocol}//${host}${path}?${query}&X-Amz-Signature=${signature}`;
}

const PART_SIZE = 64 * 1024 * 1024;

/**
 * Uploads an async-iterable of byte chunks to `key` using S3 multipart upload, so memory stays
 * bounded (one part at a time) and no chunked transfer encoding is needed.
 */
export async function uploadStream(cfg, key, chunks, onProgress = () => {}) {
  const init = await fetch(presign(cfg, key, { method: "POST", query: { uploads: "" } }), { method: "POST" });
  if (!init.ok) throw new Error(`create multipart failed: ${init.status} ${await init.text()}`);
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await init.text())?.[1];
  if (!uploadId) throw new Error("no UploadId in response");

  const etags = [];
  let buffer = [];
  let buffered = 0;
  let sent = 0;
  const flush = async () => {
    if (buffered === 0) return;
    const body = Buffer.concat(buffer, buffered);
    const partNumber = etags.length + 1;
    const url = presign(cfg, key, { method: "PUT", expires: 6 * 3600, query: { partNumber: String(partNumber), uploadId } });
    const res = await fetch(url, { method: "PUT", body });
    if (!res.ok) throw new Error(`part ${partNumber} failed: ${res.status} ${await res.text()}`);
    etags.push(res.headers.get("etag"));
    sent += buffered;
    onProgress(sent);
    buffer = [];
    buffered = 0;
  };
  try {
    for await (const chunk of chunks) {
      buffer.push(Buffer.from(chunk));
      buffered += chunk.length;
      if (buffered >= PART_SIZE) await flush();
    }
    await flush();
    const xml =
      "<CompleteMultipartUpload>" +
      etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join("") +
      "</CompleteMultipartUpload>";
    const done = await fetch(presign(cfg, key, { method: "POST", query: { uploadId } }), { method: "POST", body: xml });
    if (!done.ok) throw new Error(`complete multipart failed: ${done.status} ${await done.text()}`);
    return sent;
  } catch (e) {
    await fetch(presign(cfg, key, { method: "DELETE", query: { uploadId } }), { method: "DELETE" }).catch(() => {});
    throw e;
  }
}
