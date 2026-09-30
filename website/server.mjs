import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const port = process.env.PORT || 3000;

const app = express();

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
