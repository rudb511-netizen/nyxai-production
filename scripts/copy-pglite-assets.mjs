#!/usr/bin/env node
/**
 * Nitro's Vercel output does not emit PGLite's sidecar .data/.wasm next to the
 * bundled server module. Local `vite preview` then dies with ENOENT. Deployed
 * apps use Neon (DATABASE_URL) and never load PGLite — this copy is for the
 * preview smoke path and any fallback without DATABASE_URL.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const destDir = join(root, ".vercel/output/functions/__server.func/_libs");

if (!existsSync(destDir)) {
  console.warn("[pglite-assets] no server output yet — skip");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
  const from = join(srcDir, name);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(destDir, name));
  console.log("[pglite-assets] copied", name);
}
