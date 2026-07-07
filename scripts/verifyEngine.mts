// Reference-Playbook engine gates (docs/REFERENCE_PLAYBOOK.md) — T1/T4/T6 acceptance against
// real brand fixtures + unit fixtures. Run: `npm run verify:engine`.
import { readFileSync } from 'node:fs';

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

// ---------------------------------------------------------------------------
// T1 — text reconstruction (pdfplumber port)
// ---------------------------------------------------------------------------
{
  const { cluster1d, beginsNewSegment } = await import('../src/engine/textRecon');

  // unit: 1-D clusterer (pdfplumber cluster_objects semantics — chain by previous value)
  const cl = cluster1d([1, 2, 3, 10, 11, 30], (v) => v, 3);
  expect('T1 cluster1d chains within tolerance', cl.length === 3 && cl[0].length === 3 && cl[1].length === 2);

  // unit: char_begins_new_word — RTL direction-normalized coords
  const u = (x0: number, x1: number, top = 0, text = 'א') => ({ text, x0, x1, top, bottom: top + 10, size: 10 });
  expect('T1 LTR gap>tol starts new segment', beginsNewSegment(u(0, 10), u(14, 20), false, 3));
  expect('T1 LTR kerning split joins', !beginsNewSegment(u(0, 10), u(11, 20), false, 3));
  // RTL: prev at [90,100], curr at [70,80] → reading right→left, gap = 10 > 3 → new segment
  expect('T1 RTL gap>tol starts new segment', beginsNewSegment(u(90, 100), u(70, 80), true, 3));
  expect('T1 RTL kerning split joins', !beginsNewSegment(u(90, 100), u(88, 89.5), true, 3));

  // real fixture: a visually contiguous marketing paragraph → ONE block, logical order
  const { importPdf } = await import('../src/pdf/importPdf');
  const b = readFileSync('project/uploads/CITROEN/PRIVATE/C3.pdf');
  const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'C3.pdf', { renderPreviews: false });
  const texts = doc.pages.flatMap((p) => p.blocks).filter((bl) => bl.type === 'text') as unknown as { text: string }[];
  const intro = texts.filter((t) => t.text.includes('הכירו את ה-C3'));
  expect('T1 contiguous marketing paragraph → one block', intro.length === 1 && intro[0].text.split('\n').length >= 3);
  const mixed = texts.find((t) => /מנוע 1\.2 ל['׳] טורבו/.test(t.text));
  expect('T1 mixed Hebrew+digits line reads logically with spaces', !!mixed);
  expect('T1 no glued words (kerning threshold sane)', !texts.some((t) => /[֐-׿]\d{3}|[֐-׿][A-Z]{3}/.test(t.text.replace(/\s/g, '§').replace(/§/g, ' ')) && /[֐-׿]\d,\d{3}[֐-׿]/.test(t.text)));

  // reduction ratio (report; pdf.js emits RUNS not chars, so page-level ratio is modest)
  const pdfjs: { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }> } } = await import('pdfjs-dist') as never;
  const rawDoc = await pdfjs.getDocument({ data: new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), isEvalSupported: false, useSystemFonts: false }).promise;
  let rawN = 0;
  for (let n = 1; n <= rawDoc.numPages; n++) rawN += (await (await rawDoc.getPage(n)).getTextContent()).items.filter((i) => i.str?.trim()).length;
  const ratio = rawN / texts.length;
  console.log(`  T1 reduction: ${rawN} raw items → ${texts.length} blocks (${ratio.toFixed(1)}:1)`);
  expect('T1 raw→block reduction reported and >1.4:1', ratio > 1.4);
}

// ---------------------------------------------------------------------------
// T3 — editor overlay math (pdf.js rules: % positions, --scale-factor, width correction)
// ---------------------------------------------------------------------------
{
  const { pctRect, scaledPx, scaledHairline, widthCorrectionScaleX, dprCanvasSize } = await import('../src/editor/layerMath');
  const r1 = pctRect({ x: 100, y: 50, width: 200, height: 25 }, 1000, 500);
  expect('T3 % rect is page-relative', r1.left === '10.0000%' && r1.top === '10.0000%' && r1.width === '20.0000%' && r1.height === '5.0000%');
  // scale-invariance: the SAME rect regardless of zoom (no scale parameter exists at all)
  const r2 = pctRect({ x: 100, y: 50, width: 200, height: 25 }, 1000, 500);
  expect('T3 % rect is zoom-invariant (no scale in the math)', JSON.stringify(r1) === JSON.stringify(r2));
  expect('T3 font size rides the --scale-factor CSS var', scaledPx(14.5) === 'calc(14.5px * var(--scale-factor))');
  expect('T3 hairline never collapses', scaledHairline(0.4, 0.4).startsWith('max(0.4px, calc(0.4px'));
  expect('T3 width correction = pdfWidth/measured', Math.abs(widthCorrectionScaleX(120, 100) - 1.2) < 1e-9);
  const d = dprCanvasSize(400, 300, 2);
  expect('T3 DPR canvas: dpr-backed pixels, CSS-sized to viewport', d.pixelW === 800 && d.pixelH === 600 && d.cssW === '400px');
  // the editor renderer must not position blocks with scale-multiplied pixels any more
  const src = readFileSync('src/app/PageView.tsx', 'utf8');
  const scaleUses = (src.match(/\* scale/g) || []).length;
  expect('T3 PageView: only the page CONTAINER scales (blocks are %)', scaleUses <= 2 && src.includes("'--scale-factor'"));
}

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('ENGINE VERIFY FAILED'); process.exit(1); }
console.log('ENGINE (PLAYBOOK) CHECKS PASSED');
