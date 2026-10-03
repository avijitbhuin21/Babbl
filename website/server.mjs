import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bucketFromEnv, presign } from "./s3.mjs";
import { mirrorModels } from "./mirror.mjs";
import seo from "./seo-routes.json" with { type: "json" };

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

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Returns index.html with the title, description, canonical and Open Graph tags for one route. */
const renderPage = (template, route, meta) => {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = `${seo.siteUrl}${route === "/" ? "/" : route}`;
  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${description}$2`)
    .replace("</head>", `    <link rel="canonical" href="${url}" />\n    <meta property="og:url" content="${url}" />\n  </head>`);
};

let template = null;
const pages = new Map();
const loadPages = () => {
  if (template) return;
  template = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  for (const [route, meta] of Object.entries(seo.routes)) pages.set(route, renderPage(template, route, meta));
};

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /models/\n\nSitemap: ${seo.siteUrl}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (_req, res) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = Object.entries(seo.routes)
    .map(
      ([route, meta]) =>
        `  <url><loc>${seo.siteUrl}${route}</loc><lastmod>${lastmod}</lastmod><priority>${meta.priority}</priority></url>`,
    )
    .join("\n");
  res
    .type("application/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

app.use(
  express.static(dist, {
    index: false,
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.get("*", (req, res) => {
  loadPages();
  const route = req.path.length > 1 ? req.path.replace(/\/+$/, "") : "/";
  res.setHeader("Cache-Control", "no-cache");
  const page = pages.get(route);
  if (page) return res.type("html").send(page);
  res
    .status(404)
    .type("html")
    .send(template.replace("</head>", `    <meta name="robots" content="noindex" />\n  </head>`));
});

app.listen(port, () => console.log(`Babbl website listening on :${port}`));
