import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bucketFromEnv, presign } from "./s3.mjs";
import { mirrorModels } from "./mirror.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const port = process.env.PORT || 3000;
const bucket = bucketFromEnv();
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

const app = express();

// Admin: mirror model files into the bucket from Railway's fast network. Disabled unless ADMIN_TOKEN is set.
const mirrorLog = [];
let mirrorRunning = false;
const requireAdmin = (req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get("x-admin-token") !== token) return res.sendStatus(404);
  next();
};
app.post("/admin/mirror-models", requireAdmin, (_req, res) => {
  if (!bucket) return res.status(503).send("Model storage is not configured");
  if (mirrorRunning) return res.status(409).json({ running: true, log: mirrorLog });
  mirrorRunning = true;
  mirrorLog.length = 0;
  const log = (line) => {
    mirrorLog.push(`${new Date().toISOString()} ${line}`);
    console.log(`[mirror] ${line}`);
  };
  mirrorModels(bucket, undefined, log).finally(() => {
    mirrorRunning = false;
  });
  res.status(202).json({ started: true });
});
app.get("/admin/mirror-models", requireAdmin, (_req, res) => res.json({ running: mirrorRunning, log: mirrorLog }));

// Model downloads: redirect to a short-lived presigned bucket URL so the bytes come straight from
// the bucket (free egress) instead of through this service. Range requests / resume keep working.
app.all("/models/:file", (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.sendStatus(405);
  if (!bucket) return res.status(503).send("Model storage is not configured");
  if (!MODEL_NAME.test(req.params.file)) return res.sendStatus(400);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, presign(bucket, `models/${req.params.file}`, { method: req.method, expires: 3600 }));
});

app.use(
  express.static(dist, {
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, () => console.log(`Babbl website listening on :${port}`));
