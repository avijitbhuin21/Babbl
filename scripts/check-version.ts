/**
 * Verifies that package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml
 * all carry the same version, and optionally that it matches a release tag (v1.2.3).
 *
 * Usage: bun run scripts/check-version.ts [vX.Y.Z]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const pkgVersion: string = readJson("package.json").version;
const tauriVersion: string = readJson("src-tauri/tauri.conf.json").version;

const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
const cargoVersion = cargoMatch?.[1] ?? "";

const versions = {
  "package.json": pkgVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": cargoVersion,
};

const unique = new Set(Object.values(versions));
let failed = false;

if (unique.size !== 1) {
  console.error("Version mismatch:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version || "(missing)"}`);
  }
  failed = true;
}

const tag = process.argv[2];
if (tag) {
  const tagVersion = tag.replace(/^v/, "");
  if (tagVersion !== pkgVersion) {
    console.error(`Tag ${tag} does not match package version ${pkgVersion}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Version OK: ${pkgVersion}`);
