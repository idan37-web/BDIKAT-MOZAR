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
expect('spec page consolidated to <=3 slots', specPages.every((p) => p.slots.length <= 3));
expect('spec page has a dynamic spec-table', specPages.some((p) => p.slots.some((s) => s.kind === 'spec-table' && s.dynamic)));

const back = tpl.pages.find((p) => p.role === 'back');
expect('found back/legal page', !!back);

expect('cross-doc evidence produced fixed slots', sum.fixed > 0 && sum.crossDoc > 0);
expect('both dynamic and fixed slots exist', sum.dynamic > 0 && sum.fixed > 0);

// single-doc fallback still yields a usable spec (everything dynamic, no evidence)
const t1 = summarizeTemplate(learnTemplate([d3008]));
expect('single-doc fallback works', t1.slots > 0 && t1.crossDoc === 0);

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL TEMPLATE-LEARNING CHECKS PASSED');
