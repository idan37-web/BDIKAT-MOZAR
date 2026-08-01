// Stage 9 (C.10) gate — REAL offline PWA check.
// Serves the production build, loads it once online (so the service worker installs
// and caches the app shell), then goes OFFLINE, reloads, and asserts the app still
// mounts. Also checks the manifest + icons are present and reachable.
// Run: npm run verify:pwa   (the npm script builds dist/ first)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist';
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('✗ dist/index.html missing — run `vite build` first');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    if ((await stat(p).catch(() => null))?.isDirectory?.()) p = join(p, 'index.html');
    if (!existsSync(p)) p = join(ROOT, 'index.html'); // SPA fallback
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

const chromePath =
  process.env.CHROME_PATH ||
  (() => {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const dir = existsSync(base) ? readdirSync(base).find((d) => d.startsWith('chromium-')) : null;
    return dir ? join(base, dir, 'chrome-linux', 'chrome') : undefined;
  })();

let browser;
function shutdown(code) {
  Promise.resolve(browser?.close()).finally(() => { server.close(); process.exit(code); });
}
class Fail extends Error {}
const fail = (m) => { throw new Fail(m); };

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const origin = `http://localhost:${port}`;

browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

try {
// 1) First load ONLINE — app mounts and the service worker registers.
await page.goto(origin + '/', { waitUntil: 'networkidle' });
const mountedOnline = await page.locator('#root *').first().count();
if (!mountedOnline) fail('app did not mount on the first (online) load');
console.log('✓ app mounts online');

// Wait for the SW to control the page (registration fires on window load).
const controlled = await page
  .waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  }, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
if (!controlled) fail('service worker never took control of the page');
console.log('✓ service worker registered and controlling');

// Manifest + icons reachable (served, correct type).
const manifest = await page.evaluate(async () => {
  const r = await fetch('./manifest.webmanifest');
  return r.ok ? await r.json() : null;
});
if (!manifest || !Array.isArray(manifest.icons) || manifest.icons.length < 2) fail('manifest missing or has too few icons');
if (manifest.display !== 'standalone') fail('manifest is not display:standalone');
const iconOk = await page.evaluate(() => fetch('./icon-512.png').then((r) => r.ok));
if (!iconOk) fail('icon-512.png not reachable');
console.log(`✓ web manifest + icons present (${manifest.icons.length} icons, standalone)`);

// 2) Go OFFLINE and reload — the acceptance criterion: the app opens offline.
await context.setOffline(true);
const netFails = await page.evaluate(() => fetch('https://example.com', { mode: 'no-cors' }).then(() => false).catch(() => true));
if (!netFails) fail('offline mode not actually engaged');

await page.reload({ waitUntil: 'domcontentloaded' });
const mountedOffline = await page
  .waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
if (!mountedOffline) fail('app did NOT mount after reloading offline (shell not cached)');
const titleOffline = await page.title();
if (!/AutoSpec/i.test(titleOffline)) fail('offline document is not the app shell');
console.log('✓ app reloads and mounts OFFLINE from the service-worker cache');

if (errors.length) console.warn('  (note: pageerrors during run:', errors.length, ')');
console.log('STAGE 9 (PWA / OFFLINE) CHECKS PASSED');
shutdown(0);
} catch (e) {
  console.error('✗', e instanceof Fail ? e.message : e);
  shutdown(1);
}
