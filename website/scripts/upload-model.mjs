// Uploads model files to the Railway bucket under models/<name>.
// Usage (from website/, linked to the Railway "website" service):
//   railway run node scripts/upload-model.mjs path/to/ggml-small.bin [more files...]
// After upload the file is downloadable at https://<site>/models/<name>.
import fs from "node:fs";
import path from "node:path";
import { bucketFromEnv, uploadStream } from "../s3.mjs";

const cfg = bucketFromEnv();
if (!cfg) {
  console.error("Bucket variables missing (BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY, ENDPOINT). Run via `railway run`.");
  process.exit(1);
}
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/upload-model.mjs <file> [file...]");
  process.exit(1);
}

for (const file of files) {
  const name = path.basename(file);
  const size = fs.statSync(file).size;
  process.stdout.write(`Uploading ${name} (${(size / 1048576).toFixed(1)} MB)... `);
  try {
    await uploadStream(cfg, `models/${name}`, fs.createReadStream(file));
  } catch (e) {
    console.error(`failed: ${e.message}`);
    process.exit(1);
  }
  console.log("done");
}
