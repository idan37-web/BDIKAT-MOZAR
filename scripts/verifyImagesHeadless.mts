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

const b = readFileSync('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '3008.pdf', { renderPreviews: true, makeCanvas });

const imgs = doc.pages.flatMap((p) => p.blocks).filter(isImageBlock);
const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });
expect('image objects decoded headlessly (no DOM)', imgs.length >= 20);
expect('sources are real data URLs (png/jpeg)', imgs.every((i) => /^data:image\/(png|jpeg);base64,/.test(i.src)));
expect('no render-crop fallback needed (clean sources)', imgs.every((i) => i.src.length > 64));

console.log(`headless: ${imgs.length} image blocks across ${doc.pages.length} pages`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('HEADLESS IMAGE VERIFY FAILED'); process.exit(1); }
console.log('HEADLESS IMAGE CHECKS PASSED');
