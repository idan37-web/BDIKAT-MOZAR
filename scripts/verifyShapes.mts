// Fidelity gate — vector design furniture (panels / accent strips / colour swatches) is
// extracted from the real PDF into ShapeBlockIR (headless, no canvas), carried through
// learning + generation, and drawn in the vector export. Run: `npm run verify:shapes`.
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { generateCatalog, dynamicSlots } from '../src/catalog/generateCatalog';
import { exportPdf } from '../src/pdf/exportPdf';
import { isShapeBlock } from '../src/types/catalog';

const imp = async (f: string) => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};
const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const d3008 = await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
const d5008 = await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf');

// (1) shapes extracted headlessly with real colours
const shapes = d3008.pages.flatMap((p) => p.blocks).filter(isShapeBlock);
expect('shapes extracted headlessly (no canvas)', shapes.length >= 10);
expect('shapes carry real hex fills', shapes.every((s) => /^#[0-9a-f]{6}$/i.test(s.fill || '')));
expect('not all shapes are black (real colours)', new Set(shapes.map((s) => s.fill)).size >= 3);

// (2) carried through learning, with per-model accent detected as dynamic
const tpl = learnTemplate([d3008, d5008]);
const shapeSlots = tpl.pages.flatMap((p) => p.slots).filter((s) => s.blockType === 'shape');
expect('shape slots learned', shapeSlots.length >= 10);
expect('per-model accent detected as a dynamic shape', shapeSlots.some((s) => s.dynamic && s.crossDocEvidence));
expect('fixed brand panels detected', shapeSlots.some((s) => !s.dynamic));
// gridlines/rules learned into the fixed design layer (not slots)
const designLines = tpl.pages.flatMap((p) => p.design || []).filter((d) => d.line);
expect('table gridlines learned into the design layer', designLines.length >= 50);

// (3) carried through generation + drawn in export
const model = dynamicSlots(tpl).find((s) => s.slot.kind === 'model-name')!.slot;
const doc = generateCatalog(tpl, { [model.key]: { key: model.key, text: 'פיג׳ו 408' } });
const genShapes = doc.pages.flatMap((p) => p.blocks).filter(isShapeBlock);
expect('generated catalog carries shape blocks', genShapes.length >= 10);
const pdf = await exportPdf(doc, new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf')));
expect('export with shapes produced a real PDF', String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-');

console.log(`shapes: ${shapes.length} extracted · ${shapeSlots.length} slots (${shapeSlots.filter((s) => s.dynamic).length} dynamic accent) · ${genShapes.length} generated`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('SHAPES VERIFY FAILED'); process.exit(1); }
console.log('SHAPE-FIDELITY CHECKS PASSED');
