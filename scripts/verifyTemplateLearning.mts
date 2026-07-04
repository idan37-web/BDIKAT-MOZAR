// Stage 6 (C.8) verification — runs the REAL importer + learner over the real client
// PDFs (no browser needed: text-only IR import works under Node) and asserts the key
// invariants. Run: `npm run verify:learn`.
import { readFileSync } from 'node:fs';
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate, summarizeTemplate } from '../src/templates/templateLearning';
import type { DocumentIR } from '../src/types/catalog';

// Headless image path: decode embedded photos via @napi-rs/canvas (no DOM) so the LEARN gate
// exercises the same photo + real-colour pipeline the browser app uses.
(globalThis as any).ImageData = NapiImageData;
const makeCanvas = (w: number, h: number) => createCanvas(w, h) as unknown as HTMLCanvasElement;

async function imp(file: string): Promise<DocumentIR> {
  const b = readFileSync(file);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file.split('/').pop()!, { renderPreviews: true, makeCanvas });
}

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const d3008 = await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
const d5008 = await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf');
const tpl = learnTemplate([d3008, d5008]);
const sum = summarizeTemplate(tpl);
console.log('learned', JSON.stringify(sum), 'format', tpl.format);

const cover = tpl.pages[0];
const model = cover.slots.find((s) => s.kind === 'model-name');
expect('cover classified', cover.role === 'cover');
expect('cover has dynamic model-name (cross-doc)', !!model && model.dynamic && model.crossDocEvidence);

const specPages = tpl.pages.filter((p) => p.role === 'spec');
expect('found spec page(s)', specPages.length > 0);
// Round 14: a spec page is reconstructed into whole TABLE slots (one per table), not a box per
// cell/row — so the review shows "a table", and generation emits an editable TableBlockIR.
const specTables = specPages.flatMap((p) => p.slots).filter((s) => s.blockType === 'table' && s.kind === 'spec-table');
expect('spec page → whole spec-table slot(s)', specTables.length > 0);
expect('spec table has real rows × columns', specTables.some((s) => (s.table?.rows.length || 0) >= 6 && (s.table?.columns || 0) >= 2));
expect('spec table has label + value cells (a real grid)', specTables.some((s) =>
  s.table!.rows.some((r) => r.kind === 'data' && r.cells.length >= 2 && r.cells[0] && r.cells[1])));
// consolidation: a spec page is now a handful of table/heading slots, not dozens of cell boxes
expect('spec page consolidated (few slots, not per-cell)', specPages.every((p) => p.slots.filter((s) => s.blockType === 'text' || s.blockType === 'table').length < 12));

const back = tpl.pages.find((p) => p.role === 'back');
expect('found back/legal page', !!back);

expect('cross-doc evidence produced fixed slots', sum.fixed > 0 && sum.crossDoc > 0);
expect('both dynamic and fixed slots exist', sum.dynamic > 0 && sum.fixed > 0);

// early pages (before the first data/table page) must NOT carry table-only text kinds
const DATA = new Set(['spec', 'safety', 'colors', 'wheels', 'price']);
const TABLE_ONLY = new Set(['spec-table', 'equipment', 'safety', 'colors', 'colors-interior', 'wheels', 'pollution', 'price']);
let firstData = tpl.pages.findIndex((p) => DATA.has(p.role));
if (firstData < 0) firstData = tpl.pages.length;
const earlyBad = tpl.pages.slice(0, firstData).flatMap((p) => p.slots.filter((s) => s.blockType === 'text' && TABLE_ONLY.has(s.kind)));
expect('early (cover/marketing) pages carry no table-only text kinds', firstData > 0 && earlyBad.length === 0);

// single-doc fallback still yields a usable spec (everything dynamic, no evidence)
const t1 = summarizeTemplate(learnTemplate([d3008]));
expect('single-doc fallback works', t1.slots > 0 && t1.crossDoc === 0);

// headless photo path: the learned template carries real image slots (hero/interior photos),
// decoded via @napi-rs/canvas — not just text/shapes.
const imageSlots = tpl.pages.flatMap((p) => p.slots).filter((s) => s.blockType === 'image');
expect('headless learn carries image slots (photos via napi-canvas)', imageSlots.length >= 3);

// real text colours from the op-list: the template's text token is a real colour and a saturated
// brand accent is recovered (Peugeot red), not the #111418 placeholder.
const textColors = d3008.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'text' && !b.deleted).map((b) => (b as { color?: string }).color);
const realColorRatio = textColors.filter((c) => c && c !== '#111418').length / Math.max(1, textColors.length);
expect('text colours recovered from op-list (mostly non-placeholder)', realColorRatio > 0.6);
const isSat = (hex?: string) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return false; const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return Math.max(r, g, b) - Math.min(r, g, b) > 40 && Math.max(r, g, b) > 60; };
expect('learned tokens.accent is a real saturated colour', isSat(tpl.tokens.accent));
console.log('colours:', JSON.stringify(tpl.tokens), '| image slots:', imageSlots.length, '| real-colour ratio:', realColorRatio.toFixed(2));

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL TEMPLATE-LEARNING CHECKS PASSED');
