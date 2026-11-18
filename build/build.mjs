// Builds the single self-contained HTML file.
//   node build/build.mjs            -> dist/graphcalc.html, dist/index.html and dist/sw.js
//
// src/index.html is a normal page that also runs unbundled in development
// (served by build/serve.mjs). The build replaces each
//   <link rel="stylesheet" href="...">          with an inline <style>
//   <script type="module" src="..."></script>   with the bundled script
// and substitutes __BUILD_INFO__ with the version, commit and date.
//
// It also writes dist/sw.js from src/sw.js (D45): the service worker the Pages site
// serves beside the page for offline start. Its cache name is the build stamp plus a
// hash of the page, so the worker's bytes change whenever the page does.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { bundle } from './bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

function buildInfo() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* not a git checkout, or no commits yet */ }
  const date = new Date().toISOString().slice(0, 10);
  return `v${pkg.version} · ${sha} · ${date}`;
}

export function build() {
  let html = readFileSync(join(SRC, 'index.html'), 'utf8');

  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_all, href) => {
    const css = readFileSync(join(SRC, href), 'utf8').replace(/<\/style/gi, '<\\/style');
    return `<style>/* ${href} */\n${css.trimEnd()}\n</style>`;
  });

  html = html.replace(/<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/g, (_all, src) => {
    const js = bundle(join(SRC, src), { root: SRC }).replace(/<\/script/gi, '<\\/script');
    return `<script>\n${js}</script>`;
  });

  if (/<link\s+rel="stylesheet"|<script\s+type="module"\s+src=/.test(html)) {
    throw new Error('index.html still references an external stylesheet or module after inlining');
  }

  const info = buildInfo();
  html = html.replaceAll('__BUILD_INFO__', info);

  // ASCII only: "v1.0.0 · abc1234 · 2026-11-18" -> "v1.0.0 abc1234 2026-11-18".
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 12);
  const cacheName = `web-graphing-calc ${info.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim()} ${hash}`;
  const sw = readFileSync(join(SRC, 'sw.js'), 'utf8').replaceAll('__CACHE_NAME__', cacheName);

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, 'graphcalc.html'), html);
  writeFileSync(join(DIST, 'index.html'), html);
  writeFileSync(join(DIST, 'sw.js'), sw);
  return { bytes: Buffer.byteLength(html), info, cacheName };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bytes } = build();
  console.log(`Built dist/graphcalc.html (${(bytes / 1024).toFixed(1)} KB)`);
}
