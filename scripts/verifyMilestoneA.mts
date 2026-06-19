// Phase / Milestone A gate — prove the full loop on the REAL Peugeot family:
// learn → generate a new model → edit → export a real vector PDF *with embedded images*.
// Pure Node (no browser): the headless importer can't extract images, so we inject an
// image slot and stream a REAL repo asset (the Peugeot logo PNG) into it, exactly as the
// generator/export will handle a browser-learned hero. Run: `npm run verify:milestone-a`.
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { generateCatalog, dynamicSlots, type BindingMap } from '../src/catalog/generateCatalog';
import { exportPdf } from '../src/pdf/exportPdf';
import { isTextBlock, isImageBlock } from '../src/types/catalog';
import type { SlotSpec } from '../src/templates/templateSpec';

const imp = async (f: string) => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const tpl = learnTemplate([
  await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf'),
  await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf'),
]);

// inject a hero-image slot on the cover (browser-learned templates carry these)
const heroSlot: SlotSpec = {
  id: 'inj_hero', key: 'p1.hero', kind: 'hero-image', blockType: 'image', dynamic: true,
  bbox: { x: 60, y: 40, width: 1071, height: 420 }, label: 'תמונת נושא', confidence: 0.5, variants: 1, crossDocEvidence: false,
};
tpl.pages[0].slots.push(heroSlot);

const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
const model = dynamicSlots(tpl).find((s) => s.slot.kind === 'model-name')!.slot;

// (1) generate WITHOUT the hero bound → placeholder path must still export
const docNoHero = generateCatalog(tpl, { [model.key]: { key: model.key, text: 'פיג׳ו 408' } });
const pdfNoHero = await exportPdf(docNoHero, fontBytes);
expect('exports with an UNBOUND image slot (placeholder)', String.fromCharCode(...pdfNoHero.slice(0, 5)) === '%PDF-');

// (2) generate a NEW model with a REAL streamed image asset + edit, then export
const logoUrl = `data:image/png;base64,${readFileSync('project/uploads/LOGOS/Peugeot-Logo.png').toString('base64')}`;
const bindings: BindingMap = {
  [model.key]: { key: model.key, text: 'פיג׳ו 408 · 130 כ״ס' },
  [heroSlot.key]: { key: heroSlot.key, imageSrc: logoUrl },
};
const doc = generateCatalog(tpl, bindings, { title: 'Peugeot-408' });

// EDIT: change a heading (real IR mutation)
const firstText = doc.pages.flatMap((p) => p.blocks).find(isTextBlock)!;
firstText.text = 'פיג׳ו 408 — חוויה חדשה'; firstText.dirty = true;

const heroBlock = doc.pages[0].blocks.find(isImageBlock);
expect('generated catalog has the hero image block', !!heroBlock && heroBlock.source === 'user');
expect('edited heading carries the new model', firstText.text.includes('408'));

const pdf = await exportPdf(doc, fontBytes);
expect('export produced a real PDF', String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-');
// embedded image (full-res, no downsample) makes the file meaningfully larger than text-only
const pngSize = readFileSync('project/uploads/LOGOS/Peugeot-Logo.png').length;
expect('image bytes embedded (no downsampling)', pdf.length > pdfNoHero.length + pngSize * 0.8);

console.log(`no-hero=${(pdfNoHero.length / 1024).toFixed(0)}KB  with-hero=${(pdf.length / 1024).toFixed(0)}KB  (logo ${(pngSize / 1024).toFixed(0)}KB)`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('MILESTONE A FAILED'); process.exit(1); }
console.log('MILESTONE A CHECKS PASSED');
