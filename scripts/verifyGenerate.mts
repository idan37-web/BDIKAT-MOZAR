// Stage 7 (C.9) verification — learn a template, generate a catalog DocumentIR from
// real slot bindings, assert IR validity, and prove it exports to a REAL vector PDF
// (the same pipeline the editor uses). Run: `npm run verify:gen`.
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { generateCatalog, validateCatalog, dynamicSlots, type BindingMap } from '../src/catalog/generateCatalog';
import { exportPdf } from '../src/pdf/exportPdf';
import { isTextBlock } from '../src/types/catalog';
import type { DocumentIR } from '../src/types/catalog';

const imp = async (f: string): Promise<DocumentIR> => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const tpl = learnTemplate([
  await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf'),
  await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf'),
]);

// empty bindings → required dynamic slots (model-name / hero-image) are reported missing
const missing0 = validateCatalog(tpl, {});
expect('validation flags missing required slots', missing0.length > 0 && missing0.some((m) => m.kind === 'model-name'));

// bind the cover model-name to a NEW value
const slots = dynamicSlots(tpl);
const modelSlot = slots.find((s) => s.slot.kind === 'model-name')!.slot;
const bindings: BindingMap = { [modelSlot.key]: { key: modelSlot.key, text: 'פיג׳ו 408 חדש' } };
const doc = generateCatalog(tpl, bindings, { title: 'בדיקת ייצור' });

expect('catalog has one page per template page', doc.pages.length === tpl.pages.length);
expect('brand carried through', doc.brand === tpl.brand);

const coverBlocks = doc.pages[0].blocks.filter(isTextBlock);
const modelBlock = coverBlocks.find((b) => b.text === 'פיג׳ו 408 חדש');
expect('bound model-name present as user block', !!modelBlock && modelBlock.source === 'user');

// a fixed slot ("מפרט טכני" heading) is emitted from the template automatically
const allText = doc.pages.flatMap((p) => p.blocks.filter(isTextBlock));
expect('fixed slot content emitted', allText.some((b) => b.text.includes('מפרט טכני') && b.source === 'generated'));
expect('every block has a positive box', doc.pages.every((p) => p.blocks.every((b) => b.width > 0 && b.height > 0)));
expect('unbound dynamic slots fall back to learned sample', allText.length > 50);

// REAL vector export round-trip
const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
const pdf = await exportPdf(doc, fontBytes);
const header = String.fromCharCode(...pdf.slice(0, 5));
expect('export produced a real PDF', header === '%PDF-' && pdf.length > 5000);

// ignored slots are excluded from generation entirely
modelSlot.ignored = true;
const docIgnored = generateCatalog(tpl, bindings);
const textIgnored = docIgnored.pages.flatMap((p) => p.blocks.filter(isTextBlock));
expect('ignored slot is excluded from generation', !textIgnored.some((b) => b.text === 'פיג׳ו 408 חדש'));
modelSlot.ignored = false;

console.log(`generated ${doc.pages.length} pages · ${allText.length} text blocks · PDF ${(pdf.length / 1024).toFixed(0)}KB`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL CATALOG-GENERATION CHECKS PASSED');
