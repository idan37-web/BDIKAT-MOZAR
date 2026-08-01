// Vector-graphics extraction gate — proves walkPage detects logos / QR / colour-scale regions
// (which can't be rebuilt as primitives and are rasterized from the page render in the app).
// Run: `npm run verify:graphics`.
import { readFileSync } from 'node:fs';
const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { walkPage } = await import('../src/pdf/extractImages');

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

async function graphicsOf(path: string) {
  const b = readFileSync(path);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), isEvalSupported: false, useSystemFonts: false }).promise;
  const all: { page: number; kind: string; w: number; h: number; ops: number }[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const { graphics } = await walkPage(page, pdfjs.OPS, vp.height);
    for (const g of graphics) all.push({ page: i, kind: g.kind, w: g.bbox.width, h: g.bbox.height, ops: g.opCount });
  }
  return all;
}

const g = await graphicsOf('project/uploads/CITROEN/PRIVATE/C5 aircross.pdf');
const kinds = g.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] || 0) + 1), m), {});
console.log('C5 aircross graphics:', JSON.stringify(kinds), `(${g.length} total)`);

expect('a QR/barcode region detected', g.some((x) => x.kind === 'qr' && x.ops >= 80));
expect('a brand-logo region detected', g.some((x) => x.kind === 'logo'));
expect('at least one colour-scale region detected', g.some((x) => x.kind === 'scale'));
expect('every graphic box is sane (not full-page)', g.every((x) => x.w >= 8 && x.h >= 8 && x.w <= 520 && x.h <= 520));
// the QR is a dense cluster of tiny squares
const qr = g.find((x) => x.kind === 'qr');
expect('QR is a dense tiny-square cluster', !!qr && qr.ops >= 80);

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VECTOR-GRAPHICS VERIFY FAILED'); process.exit(1); }
console.log('VECTOR-GRAPHICS CHECKS PASSED');
