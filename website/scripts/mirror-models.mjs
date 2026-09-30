// Mirrors model files from the upstream host into the Railway bucket (models/<name>).
// Usage (from website/, linked to the Railway "website" service):
//   railway run node scripts/mirror-models.mjs [name ...]
// For large batches prefer the server-side route (POST /admin/mirror-models) — Railway's network is much faster.
import { bucketFromEnv } from "../s3.mjs";
import { MODELS, mirrorModels } from "../mirror.mjs";

const cfg = bucketFromEnv();
if (!cfg) {
  console.error("Bucket variables missing. Run via `railway run`.");
  process.exit(1);
}
const names = process.argv.slice(2);
const selected = names.length ? MODELS.filter((m) => names.includes(m.file)) : MODELS;
process.exitCode = (await mirrorModels(cfg, selected)) ? 1 : 0;
