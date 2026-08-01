// Edit-path table reconstruction gate (Round 15). Proves that importing WITH reconstructTables
// turns a dense spec page's raw cells + coloured section bands into ONE clean editable TableBlockIR
// (white cells, captured section background) — the fix for "the table isn't a table / the yellow
// band bleeds over the whole table in the editor". Run: `npm run verify:edit-tables`.
import { readFileSync } from 'node:fs';
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import type { PageIR, BlockIR, ShapeBlockIR, TableBlockIR } from '../src/types/catalog';
(globalThis as any).ImageData = NapiImageData;
const makeCanvas = (w: number, h: number) => createCanvas(w, h) as unknown as HTMLCanvasElement;

const { importPdf } = await import('../src/pdf/importPdf');
const { reconstructTables } = await import('../src/templates/tableDetect');
const { exportPdf } = await import('../src/pdf/exportPdf');

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

// (1) REAL PDF: importing with reconstructTables yields TableBlockIR on dense pages, and NO coloured
// non-thin band shape is left INSIDE a table (those bleed in the editor).
const b = readFileSync('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '3008.pdf', { renderPreviews: true, makeCanvas, reconstructTables: true });
const tableBlocks = doc.pages.flatMap((p) => p.blocks).filter((bl): bl is TableBlockIR => bl.type === 'table');
expect('import reconstructs spec tables (TableBlockIR)', tableBlocks.length >= 2);
expect('reconstructed tables have real rows × columns', tableBlocks.some((t) => t.rows.length >= 6 && t.columns >= 2));
expect('reconstructed tables paint white cells', tableBlocks.every((t) => t.cellBg === '#ffffff'));
const lum = (hex: string) => { const m = /^#(..)(..)(..)$/.exec(hex); if (!m) return 1; const [r, g, bl] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return (0.299 * r + 0.587 * g + 0.114 * bl) / 255; };
const ovFrac = (a: { x: number; y: number; width: number; height: number }, c: typeof a) => {
  const ix = Math.max(0, Math.min(a.x + a.width, c.x + c.width) - Math.max(a.x, c.x));
  const iy = Math.max(0, Math.min(a.y + a.height, c.y + c.height) - Math.max(a.y, c.y));
  return a.width * a.height > 0 ? (ix * iy) / (a.width * a.height) : 0;
};
let bleeders = 0;
for (const p of doc.pages) {
  const tbs = p.blocks.filter((bl): bl is TableBlockIR => bl.type === 'table');
  const shapes = p.blocks.filter((bl): bl is ShapeBlockIR => bl.type === 'shape' || bl.type === 'background');
  for (const s of shapes) {
    if (!s.fill || Math.min(s.width, s.height) <= 3 || lum(s.fill) >= 0.95) continue;
    if (tbs.some((t) => ovFrac({ x: s.x, y: s.y, width: s.width, height: s.height }, t) > 0.6)) bleeders++;
  }
}
expect('no coloured band left inside a table (no bleed)', bleeders === 0);

// export still works with reconstructed tables
const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
const pdf = await exportPdf(doc, fontBytes);
expect('reconstructed doc exports to a real PDF', String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-' && pdf.length > 5000);

// (2) SYNTHETIC yellow-band case (the exact "bleed" class): a yellow band behind a section row is
// REMOVED and its colour is captured as the table's sectionBg.
{
  let z = 0;
  const txt = (x: number, y: number, w: number, t: string): BlockIR => ({ id: `t${z}`, type: 'text', x, y, width: w, height: 14, rotation: 0, zIndex: z++, source: 'original', originalBBox: { x, y, width: w, height: 14 }, text: t, originalText: t, fontFamily: 'sans', fontSize: 12, fontWeight: 400, lineHeight: 1.2, color: '#111', direction: 'rtl', align: 'end' } as BlockIR);
  const blocks: BlockIR[] = [txt(300, 40, 120, 'מנוע בנזין')];
  blocks.push({ id: 'band', type: 'shape', x: 120, y: 38, width: 340, height: 18, rotation: 0, zIndex: z++, source: 'original', originalBBox: { x: 120, y: 38, width: 340, height: 18 }, fill: '#fff200' } as BlockIR);
  const rows = [['נפח מנוע', '1,199'], ['מגדש טורבו', 'V'], ['מספר בוכנות', '3'], ['הספק', '136'], ['מומנט', '230'], ['מכל דלק', '44'], ['משקל', '1573'], ['אורך', '453']];
  rows.forEach((r, i) => { const y = 60 + i * 16; blocks.push(txt(300, y, 120, r[0])); blocks.push(txt(130, y, 40, r[1])); });
  for (let i = 0; i < 6; i++) { const y = 200 + i * 16; blocks.push(txt(300, y, 120, `שדה ${i}`)); blocks.push(txt(130, y, 40, `${i * 10}`)); }
  const page: PageIR = { id: 'p', width: 600, height: 400, rotation: 0, blocks };
  reconstructTables(page);
  const tables = page.blocks.filter((bl): bl is TableBlockIR => bl.type === 'table');
  const bandLeft = page.blocks.some((bl) => bl.type === 'shape' && (bl as ShapeBlockIR).fill === '#fff200');
  expect('yellow section band removed (no bleed)', tables.length >= 1 && !bandLeft);
  expect('section band colour captured as sectionBg', tables[0]?.sectionBg === '#fff200');
}

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('EDIT-TABLES VERIFY FAILED'); process.exit(1); }
console.log('EDIT-TABLE RECONSTRUCTION CHECKS PASSED');
