// Real-browser E2E smoke: serve dist/, import a real PDF through the UI, screenshot key pages,
// export a PDF via the export button, and screenshot the template-learning screen.
// Run: npx vite build && npx vite preview --port 4173 &  then  node scripts/e2eSmoke.mjs [pdf]
// Chromium comes from the environment (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const pdf = process.argv[2] || 'project/uploads/CITROEN/PRIVATE/C3.pdf';
const out = 'e2e-out'; mkdirSync(out, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${out}/home.png` });
await page.setInputFiles('input[type=file]', pdf);
await page.waitForSelector('text=ייצוא PDF', { timeout: 240000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/editor-p1.png` });
const dl = page.waitForEvent('download', { timeout: 120000 });
await page.click('text=ייצוא PDF');
await (await dl).saveAs(`${out}/exported.pdf`);
await page.click('text=ייבוא אחר');
await page.click('text=למידת תבנית ←');
await page.setInputFiles('input[type=file]', pdf);
await page.waitForSelector('text=שמור תבנית', { timeout: 240000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/learn.png` });
console.log('E2E OK — artifacts in', out, '| pageerrors:', errors.length);
await browser.close();
