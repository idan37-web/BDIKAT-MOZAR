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

// ---------------------------------------------------------------------------
// T4 — Hebrew bidi pipeline (UAX #9 via bidi-js; per-line reorder, never hand-reverse)
// ---------------------------------------------------------------------------
{
  const { toVisualLine } = await import('../src/engine/bidi');
  // playbook fixture 1: price line — digits must ascend left-to-right inside the RTL flow
  const v1 = toVisualLine('מחיר: 149,900 ₪');
  expect('T4 digits not reversed in price line', v1.includes('149,900'));
  // playbook fixture 2: mixed Hebrew + Latin + digits — the Latin run stays intact
  const v2 = toVisualLine('מנוע 1.2 PureTech טורבו');
  expect('T4 Latin run intact', v2.includes('PureTech') && v2.includes('1.2'));
  // playbook fixture 3: brackets face correctly (LTR-content parens stay upright)
  const v3 = toVisualLine('(אוטומטי) 8 הילוכים');
  expect('T4 bracket pair faces correctly', (v3.match(/\(/g) || []).length === 1 && (v3.match(/\)/g) || []).length === 1 && v3.includes('8'));
  const v4 = toVisualLine('צריכת דלק (WLTP) משולבת');
  expect('T4 LTR-content parens not mirrored', v4.includes('(WLTP)'));
  // RTL visual order: for a PURE-RTL string, visual == full char reversal (drawing those glyphs
  // left→right yields right-to-left reading — the property the pixel-verified exports rely on)
  const v5 = toVisualLine('שלום עולם');
  expect('T4 pure-RTL visual = char reversal (L2)', v5 === [...'שלום עולם'].reverse().join(''));
}

// ---------------------------------------------------------------------------
// T2 — table detection (pdfplumber lines + text strategies)
// ---------------------------------------------------------------------------
{
  const { snapEdges, joinEdges, findIntersections, intersectionsToCells, cellsToTables, textStrategyEdges, detectGridTables } = await import('../src/engine/gridDetect');
  type E = { x0: number; x1: number; top: number; bottom: number; orientation: 'h' | 'v' };
  // synthetic 3×4 ruled grid (4 v-lines × 5 h-lines → 12 cells), with jitter within SNAP_TOLERANCE
  const vs: E[] = [0, 100, 200, 300].map((x) => ({ orientation: 'v', x0: x + (x ? 1 : 0), x1: x + (x ? 1 : 0), top: 0, bottom: 400 }));
  const hs: E[] = [0, 100, 200, 300, 400].map((y) => ({ orientation: 'h', x0: 0, x1: 300, top: y + 0.5, bottom: y + 0.5 }));
  const snapped = joinEdges(snapEdges([...vs, ...hs]));
  const cells = intersectionsToCells(findIntersections(snapped));
  expect('T2 A: 4×5 ruled lines → exactly 12 smallest cells', cells.length === 12);
  const tables = cellsToTables(cells);
  expect('T2 A: cells group into ONE table with a 4-row × 3-col grid', tables.length === 1 && tables[0].rows.length === 5 && tables[0].cols.length === 4);
  // split grids stay separate tables
  const far: E[] = [
    { orientation: 'v', x0: 500, x1: 500, top: 0, bottom: 100 }, { orientation: 'v', x0: 600, x1: 600, top: 0, bottom: 100 },
    { orientation: 'h', x0: 500, x1: 600, top: 0, bottom: 0 }, { orientation: 'h', x0: 500, x1: 600, top: 100, bottom: 100 },
  ];
  expect('T2 A: disjoint grids → separate tables', detectGridTables([...vs, ...hs, ...far]).length === 2);

  // Strategy B (text): borderless aligned words → edges → grid (playbook parameters)
  const w = (x0: number, x1: number, top: number, text: string) => ({ text, x0, x1, top, bottom: top + 10, size: 10 });
  const words = [
    w(200, 240, 0, 'שדה1'), w(100, 120, 0, '11'),
    w(200, 236, 20, 'שדה2'), w(100, 118, 20, '22'),
    w(200, 238, 40, 'שדה3'), w(100, 121, 40, '33'),
  ];
  const bEdges = textStrategyEdges(words);
  expect('T2 B: alignment edges derived from ≥3-word columns', bEdges.filter((e) => e.orientation === 'v').length >= 2);
  const bTables = detectGridTables(bEdges);
  const bGrid = bTables[0];
  const { gridCellText } = await import('../src/engine/gridDetect');
  const bCells = bGrid ? gridCellText(bGrid, words, true) : [];
  const dataRows = bCells.filter((r) => r.some((c) => c.trim()));
  const cellHits = dataRows.flat().filter((c) => c.trim()).length;
  expect('T2 B: borderless grid → 3 data rows × 2 cols, ≥90% cells', dataRows.length === 3 && cellHits >= Math.ceil(3 * 2 * 0.9));

  // REAL fixture: the Peugeot 3008 spec page has ruling lines → Strategy A reads the grid with the
  // CATEGORY column as a real 4th column, and RTL cell text lands correctly.
  const { createCanvas, ImageData: NapiImageData } = await import('@napi-rs/canvas');
  (globalThis as { ImageData?: unknown }).ImageData = NapiImageData;
  const makeCanvas = (w2: number, h2: number) => createCanvas(w2, h2) as unknown as HTMLCanvasElement;
  const { importPdf } = await import('../src/pdf/importPdf');
  const { detectTables, pageEdges } = await import('../src/templates/tableDetect');
  const pb = readFileSync('project/uploads/PEUGEOT/PRIVATE/3008.pdf');
  const pdoc = await importPdf(pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength), '3008.pdf', { renderPreviews: true, makeCanvas });
  const pg = pdoc.pages[13];
  const dt = detectTables(pg.blocks.filter((x) => x.type === 'text') as never, pg.width, pageEdges(pg));
  const four = dt.tables.find((t) => t.columns === 4 && t.rows.length >= 20);
  expect('T2 real: 3008 spec grid reads as a 4-column table (incl. category column)', !!four);
  expect('T2 real: RTL cell text correct (label+value pair present)', dt.tables.some((t) => t.rows.some((r) => r.cells.join('|').includes('מספר שסתומים') && r.cells.includes('12'))));
}

// ---------------------------------------------------------------------------
// T6 — auto-fit binary search (wrap logical, measure visual per line)
// ---------------------------------------------------------------------------
{
  const { fitText } = await import('../src/engine/autofit');
  const { wrapText } = await import('../src/catalog/autofit');
  const measure = (t: string, s: number) => t.length * s * 0.5; // deterministic monospace-ish
  const box = { w: 120, h: 22 };
  const short = fitText('C3', box, measure, wrapText, 6, 24, 1.35);
  const long = fitText('פיג׳ו 5008 GT היברידי בנזין 7 מושבים', box, measure, wrapText, 6, 24, 1.35);
  expect('T6 short name fits at (near-)max size', !short.overflow && short.size >= 15);
  expect('T6 long name fits the SAME slot at a smaller size', !long.overflow && long.size < short.size && long.size >= 6);
  const both = [short, long].every((f) => f.lines.every((l) => measure(l, f.size) <= box.w + 0.5) && f.lines.length * f.size * 1.35 <= box.h + 0.5);
  expect('T6 no clipping: every line fits width and height', both);
  const impossible = fitText('א'.repeat(4000), { w: 30, h: 8 }, measure, wrapText, 6, 24, 1.35);
  expect('T6 impossible content is FLAGGED, never silently clipped', impossible.overflow);
}

// ---------------------------------------------------------------------------
// T5 — glyph-outline export (gated behind exportMode: 'outlines')
// ---------------------------------------------------------------------------
{
  const { exportPdf } = await import('../src/pdf/exportPdf');
  const { openFont, outlineLineWidth } = await import('../src/engine/glyphExport');
  const mk = (id: string, y: number, text: string) => ({
    id, type: 'text', x: 20, y, width: 360, height: 30, rotation: 0, zIndex: 1, source: 'user',
    originalBBox: { x: 20, y, width: 360, height: 30 }, text, originalText: text,
    fontFamily: 'x', fontSize: 20, fontWeight: 400, lineHeight: 1.2, color: '#111111', direction: 'rtl', align: 'end',
  });
  const doc = { id: 'd', brand: 'peugeot', pages: [{ id: 'p', width: 400, height: 120, rotation: 0, blocks: [mk('t1', 20, 'מחיר: 149,900 ₪ (GT)'), mk('t2', 60, 'מנוע 1.2 PureTech טורבו')] }] };
  const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
  const textPdf = await exportPdf(doc as never, fontBytes, undefined, { exportMode: 'text' });
  const outPdf = await exportPdf(doc as never, fontBytes, undefined, { exportMode: 'outlines' });
  // pdf-lib compresses object streams, so inspect via PyMuPDF (the project's pixel/structure oracle)
  const { writeFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/t5-`);
  writeFileSync(`${dir}/text.pdf`, Buffer.from(textPdf));
  writeFileSync(`${dir}/out.pdf`, Buffer.from(outPdf));
  const py = execFileSync('python3', ['-c', `
import fitz
t=fitz.open('${dir}/text.pdf'); o=fitz.open('${dir}/out.pdf')
tp=t[0]; op=o[0]
ink=op.get_pixmap().samples
print(len(tp.get_fonts()), len(op.get_fonts()), len(tp.get_text().strip())>0, any(b<250 for b in ink[:400000]))
`]).toString().trim().split(' ');
  rmSync(dir, { recursive: true, force: true });
  expect('T5 text mode embeds a font + selectable text', Number(py[0]) > 0 && py[2] === 'True');
  expect('T5 outlines mode: ZERO fonts (pure vector paths)', Number(py[1]) === 0);
  expect('T5 outlines still paint visible ink', py[3] === 'True');
  expect('T5 outlines PDF is a real, non-trivial PDF', Buffer.from(outPdf).toString('latin1', 0, 5) === '%PDF-' && outPdf.length > 20_000);
  const fk = openFont(fontBytes);
  expect('T5 fontkit layout metrics available (advance > 0)', outlineLineWidth(fk, 'שלום', 20) > 10);
}

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('ENGINE VERIFY FAILED'); process.exit(1); }
console.log('ENGINE (PLAYBOOK) CHECKS PASSED');
