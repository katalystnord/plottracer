#!/usr/bin/env node
/**
 * Puts the models too large for git in place, each checked against its sha256 (David, 2026-11-08).
 *
 * The chart-element detector (ui/figdet-model/detector.onnx, 110 MB) is over GitHub's 100 MB limit for a file in git,
 * so it lives as an asset of a GitHub release kept only for models, and scripts/models.json names its URL and sha256.
 * A release asset has no bandwidth limit (GitHub, "About releases"), so every CI build can download it.
 *
 * For each model: if the file is there with the right sha256, nothing happens; otherwise it is downloaded and checked.
 * Any mismatch or failed download exits non-zero, so a build can never package a missing or different model:
 * electron-builder would skip a missing file silently, and the app would ship without its detector.
 *
 *   node scripts/fetch-models.mjs          (npm run models)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = JSON.parse(readFileSync(path.join(root, 'scripts/models.json'), 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let failed = false;
for (const m of models) {
  const dest = path.join(root, m.path);
  if (existsSync(dest) && sha256(readFileSync(dest)) === m.sha256) {
    console.log(`ok       ${m.path}`);
    continue;
  }
  console.log(`fetching ${m.path} from ${m.url}`);
  try {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== m.sha256) throw new Error(`sha256 ${got}, expected ${m.sha256}`);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, buf);
    renameSync(`${dest}.part`, dest);
    console.log(`ok       ${m.path} (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    console.error(`FAILED   ${m.path}: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
