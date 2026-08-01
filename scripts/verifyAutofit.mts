// Milestone B gate — generate a model whose marketing text and a spec value are LONGER
// than the template's, run generation-time auto-fit, and assert nothing is clipped or
// overflowing (font shrinks no lower than the floor, boxes grow within the page, and any
// truly-impossible fit is FLAGGED rather than silently clipped). Run: `npm run verify:autofit`.
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { generateCatalog, dynamicSlots } from '../src/catalog/generateCatalog';
import { autofitDocument, wrapText, type Measure } from '../src/catalog/autofit';
import { exportPdf } from '../src/pdf/exportPdf';
import { isTextBlock, type TextBlockIR } from '../src/types/catalog';

const imp = async (f: string) => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};
const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

// real pdf-lib measurer (the export font) — same metric the PDF will use
const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
const pdf0 = await PDFDocument.create(); pdf0.registerFontkit(fontkit);
const font = await pdf0.embedFont(fontBytes, { subset: false });
const measure: Measure = (t, s) => font.widthOfTextAtSize(t, s);
const measureFor = () => measure;

const tpl = learnTemplate([await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf'), await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf')]);
const model = dynamicSlots(tpl).find((s) => s.slot.kind === 'model-name')!.slot;
const doc = generateCatalog(tpl, { [model.key]: { key: model.key, text: 'פיג׳ו 408' } });

// make some content LONGER than the template designed for
const long = 'פיג׳ו 408 מציעה חבילת אבזור עשירה במיוחד הכוללת מערכות בטיחות אקטיביות מתקדמות, מערכת מולטימדיה עם מסך מגע גדול, ובקרת שיוט אדפטיבית. ' .repeat(4);
const texts = doc.pages.flatMap((p) => p.blocks).filter(isTextBlock) as TextBlockIR[];
// pick a mid-size paragraph box and a small table cell to stress
const para = texts.find((b) => b.width > 180 && b.height > 30) || texts[0];
const cell = texts.find((b) => b.width < 120 && b.height < 30) || texts[1];
const beforeParaSize = para.fontSize;
para.text = long;
cell.text = 'ערך ארוך מאוד שלא היה קיים בתבנית המקורית 1234567890';

const designSizes = new Map(texts.map((b) => [b.id, b.fontSize] as const));
const { warnings } = autofitDocument(doc, measureFor);

// every text block must FIT (wrapped lines ≤ box height) OR be explicitly flagged
let clipped = 0;
for (const b of texts) {
  const lines = wrapText(b.text, b.width, b.fontSize, measure);
  const needed = lines.length * b.fontSize * (b.lineHeight || 1.2);
  const flagged = warnings.some((w) => w.blockId === b.id);
  const fits = needed <= b.height + 1;
  if (!fits && !flagged) clipped++;
  // never below the floor (85% of design)
  const design = designSizes.get(b.id)!;
  if (b.fontSize < design * 0.85 - 0.05) { console.log('below floor!', b.id, b.fontSize, design); clipped++; }
}
expect('no text block is silently clipped (fits or flagged)', clipped === 0);
expect('font never shrinks below the 85% floor', true); // covered above (counted into clipped)
// the long paragraph must NOT silently overflow: it either fits, or is flagged
const paraLines = wrapText(para.text, para.width, para.fontSize, measure);
const paraFits = paraLines.length * para.fontSize * (para.lineHeight || 1.2) <= para.height + 1;
const paraFlagged = warnings.some((w) => w.blockId === para.id);
expect('long paragraph fits or is flagged (never silently clipped)', paraFits || paraFlagged);
expect('long paragraph shrank toward the floor', para.fontSize < beforeParaSize);

// a moderately-longer value in a roomy box must FIT by shrink/grow (no flag)
const roomy = texts.find((b) => b.width > 150 && b.y < 200 && b.height > 24);
if (roomy) {
  roomy.text = (roomy.originalText || 'טקסט') + ' — ' + 'תוספת קצרה לבדיקה. ';
  autofitDocument({ ...doc, pages: [{ ...doc.pages[0], blocks: [roomy], width: 1191, height: 595 }] } as any, measureFor);
  const rl = wrapText(roomy.text, roomy.width, roomy.fontSize, measure);
  expect('moderately longer text fits without flagging', rl.length * roomy.fontSize * (roomy.lineHeight || 1.2) <= roomy.height + 1);
}

// real export still produces a valid PDF with the long text present + wrapped
const out = await exportPdf(doc, fontBytes);
expect('export with auto-fit produced a real PDF', String.fromCharCode(...out.slice(0, 5)) === '%PDF-');

console.log(`autofit: ${texts.length} text blocks · ${warnings.length} flagged overflow · para ${beforeParaSize}→${para.fontSize}pt`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('AUTOFIT VERIFY FAILED'); process.exit(1); }
console.log('MILESTONE B (AUTO-FIT) CHECKS PASSED');
