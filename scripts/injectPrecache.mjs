// Post-build step (Stage 9): inject the built asset list into dist/sw.js so the
// service worker precaches the whole app shell on install → first offline reload works.
// Vite emits content-hashed, immutable filenames we can't know when authoring sw.js,
// so we scan dist/ after the build and rewrite the PRECACHE placeholder.
// Run by the `build` / `verify:pwa` npm scripts, right after `vite build`.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
const SW = join(DIST, 'sw.js');
if (!existsSync(SW)) {
  console.error('injectPrecache: dist/sw.js not found — did vite build run with public/sw.js?');
  process.exit(1);
}

const SKIP = new Set(['sw.js']); // never precache the SW itself
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const urls = walk(DIST)
  .map((f) => relative(DIST, f).split(sep).join('/'))
  .filter((u) => !SKIP.has(u) && !u.endsWith('.map'))
  .map((u) => './' + u);

// Always include the navigation root so a reload of '/' resolves offline.
const precache = Array.from(new Set(['./', './index.html', ...urls]));

const src = readFileSync(SW, 'utf8');
const line = `const PRECACHE = ${JSON.stringify(precache)}; /* __PRECACHE__ */`;
const next = src.replace(/const PRECACHE = \[.*?\]; \/\* __PRECACHE__ \*\//s, line);
if (next === src) {
  console.error('injectPrecache: PRECACHE placeholder not found in dist/sw.js');
  process.exit(1);
}
writeFileSync(SW, next);
console.log(`injectPrecache: precached ${precache.length} URLs into dist/sw.js`);
