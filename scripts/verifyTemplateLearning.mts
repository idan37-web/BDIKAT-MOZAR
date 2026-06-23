// Stage 6 (C.8) verification — runs the REAL importer + learner over the real client
// PDFs (no browser needed: text-only IR import works under Node) and asserts the key
// invariants. Run: `npm run verify:learn`.
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate, summarizeTemplate } from '../src/templates/templateLearning';
import type { DocumentIR } from '../src/types/catalog';

async function imp(file: string): Promise<DocumentIR> {
  const b = readFileSync(file);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file.split('/').pop()!, { renderPreviews: false });
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
// table cells are preserved as positioned slots (so generation reproduces the grid)
expect('spec page preserves positioned table cells', specPages.some((p) => p.slots.filter((s) => s.kind === 'spec-table').length > 10));
// cross-doc evidence: column labels FIXED, per-model values DYNAMIC, within the same table
expect('spec table has both fixed labels and dynamic values', specPages.some((p) =>
  p.slots.some((s) => s.kind === 'spec-table' && s.dynamic) && p.slots.some((s) => s.kind === 'spec-table' && !s.dynamic)));

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

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL TEMPLATE-LEARNING CHECKS PASSED');
