// Headless image extraction gate — proves the importer decodes image OBJECTS without a
// DOM (via a @napi-rs/canvas factory), so verification/CI can exercise the photo path the
// browser app uses. Run: `npm run verify:images`.
import { readFileSync } from 'node:fs';
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';

// objToDataUrl uses `new ImageData(...)`; provide it + a canvas factory for Node.
(globalThis as any).ImageData = NapiImageData;
const makeCanvas = (w: number, h: number) => createCanvas(w, h) as unknown as HTMLCanvasElement;

const { importPdf } = await import('../src/pdf/importPdf');
const { isImageBlock } = await import('../src/types/catalog');
const { objToDataUrl } = await import('../src/pdf/extractImages');

const b = readFileSync('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '3008.pdf', { renderPreviews: true, makeCanvas });

const imgs = doc.pages.flatMap((p) => p.blocks).filter(isImageBlock);
const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });
expect('image objects decoded headlessly (no DOM)', imgs.length >= 20);
expect('sources are real data URLs (png/jpeg)', imgs.every((i) => /^data:image\/(png|jpeg);base64,/.test(i.src)));
expect('no render-crop fallback needed (clean sources)', imgs.every((i) => i.src.length > 64));

// dedupe: no two image blocks on the same page heavily overlap (the black-box duplicate is dropped)
const iouBB = (a: typeof imgs[0], b: typeof imgs[0]) => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = a.width * a.height + b.width * b.height - inter;
  return uni <= 0 ? 0 : inter / uni;
};
let overlaps = 0;
for (const p of doc.pages) {
  const pi = p.blocks.filter(isImageBlock);
  for (let i = 0; i < pi.length; i++) for (let j = i + 1; j < pi.length; j++) if (iouBB(pi[i], pi[j]) > 0.8) overlaps++;
}
expect('duplicate overlapping images removed', overlaps === 0);

// REGRESSION (black-swatch bug): in the browser pdf.js gives an ImageBitmap (the `bitmap`
// branch). A transparent-background swatch MUST be detected as having alpha → saved as PNG,
// never opaque JPEG (which turns the transparent areas black).
{
  const W = 40, H = 40;
  const swatch = createCanvas(W, H); const sx = swatch.getContext('2d')!;
  sx.clearRect(0, 0, W, H); sx.fillStyle = '#c0142d'; sx.fillRect(10, 10, 20, 20); // transparent bg + opaque blob
  const u = objToDataUrl({ bitmap: swatch, width: W, height: H }, makeCanvas);
  expect('transparent bitmap swatch → PNG (no black background)', !!u && u.startsWith('data:image/png'));
  const opaque = createCanvas(W, H); const ox = opaque.getContext('2d')!; ox.fillStyle = '#345'; ox.fillRect(0, 0, W, H);
  const u2 = objToDataUrl({ bitmap: opaque, width: W, height: H }, makeCanvas);
  expect('opaque bitmap photo → JPEG (no size regression)', !!u2 && u2.startsWith('data:image/jpeg'));
}

console.log(`headless: ${imgs.length} image blocks across ${doc.pages.length} pages`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('HEADLESS IMAGE VERIFY FAILED'); process.exit(1); }
console.log('HEADLESS IMAGE CHECKS PASSED');
