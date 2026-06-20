// Milestone D verification — structured-data ingestion.
// Proves the REAL pipeline: SpecSheet → canonical CSV/TSV/XLSX → parse back (round-trip) →
// map onto a learned TemplateSpec → DocumentIR with a sheet-driven spec table → auto-fit →
// REAL vector PDF. Run: `npm run verify:structured`.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { exportPdf } from '../src/pdf/exportPdf';
import { isTextBlock } from '../src/types/catalog';
import type { DocumentIR } from '../src/types/catalog';
import { peugeot3008Sheet } from '../src/data/samples';
import { sheetStats } from '../src/data/specModel';
import { sheetToCells, cellsToSheet } from '../src/data/specSheetFormat';
import { toCSV, parseDelimited, parseSpreadsheet, type Cells } from '../src/data/parseSheet';
import { mapSheetToCatalog } from '../src/data/mapSheetToCatalog';

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const imp = async (f: string): Promise<DocumentIR> => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};

// ---- minimal .xlsx writer (deflate-raw, shared strings) to exercise the real reader path ----
function u16(n: number) { return Uint8Array.from([n & 255, (n >> 8) & 255]); }
function u32(n: number) { return Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]); }
function cat(parts: Uint8Array[]) { const len = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const comp = deflateRawSync(f.data);
    const local = cat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(comp.length), u32(f.data.length), u16(name.length), u16(0), name, comp]);
    locals.push(local);
    const central = cat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(comp.length), u32(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centrals.push(central);
    offset += local.length;
  }
  const cd = cat(centrals); const cdOffset = offset;
  const eocd = cat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(cdOffset), u16(0)]);
  return cat([...locals, cd, eocd]);
}
function xmlEsc(s: string) { return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)); }
function cellsToXlsx(cells: Cells): Uint8Array {
  const enc = new TextEncoder();
  const uniq: string[] = []; const idx = new Map<string, number>();
  const sid = (s: string) => { if (!idx.has(s)) { idx.set(s, uniq.length); uniq.push(s); } return idx.get(s)!; };
  const col = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  let rowsXml = '';
  cells.forEach((row, r) => {
    let cs = '';
    row.forEach((v, c) => { if (v == null || v === '') return; cs += `<c r="${col(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`; });
    rowsXml += `<row r="${r + 1}">${cs}</row>`;
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${uniq.length}" uniqueCount="${uniq.length}">${uniq.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  const ct = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return makeZip([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: 'xl/sharedStrings.xml', data: enc.encode(sst) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ]);
}

// ---------------------------------------------------------------------------
const sheet = peugeot3008Sheet();
const stats = sheetStats(sheet);
expect('sample sheet has real data', stats.rows >= 25 && stats.colors === 5 && stats.trims === 2);

// 1) round-trip through canonical CSV
const cells = sheetToCells(sheet);
const csv = toCSV(cells);
const back = cellsToSheet(parseDelimited(csv));
const s2 = sheetStats(back.sheet);
expect('CSV round-trip preserves trims', back.sheet.trims.join('|') === sheet.trims.join('|'));
expect('CSV round-trip preserves spec rows', s2.rows === stats.rows);
expect('CSV round-trip preserves values', s2.values === stats.values);
expect('CSV round-trip preserves features', s2.features === stats.features);
expect('CSV round-trip preserves colors+wheels', s2.colors === stats.colors && s2.wheels === stats.wheels);
expect('CSV round-trip preserves model/brand', back.sheet.model === sheet.model && back.sheet.brand === sheet.brand);
expect('CSV round-trip carries marketing/legal/price', !!back.sheet.marketingText && !!back.sheet.legalText && back.sheet.price === sheet.price);
expect('CSV parse reports no issues on clean data', back.issues.length === 0);

// 2) TSV (Excel often exports tab-delimited) parses identically
const tsv = cells.map((r) => r.map((c) => (c ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
const tBack = cellsToSheet(parseDelimited(tsv));
expect('TSV round-trip preserves rows+values', sheetStats(tBack.sheet).rows === stats.rows && sheetStats(tBack.sheet).values === stats.values);

// 3) real .xlsx (deflate + shared strings) parses back
const xlsxBytes = cellsToXlsx(cells);
const xCells = await parseSpreadsheet('data.xlsx', xlsxBytes);
const xBack = cellsToSheet(xCells);
expect('XLSX round-trip preserves rows', sheetStats(xBack.sheet).rows === stats.rows);
expect('XLSX round-trip preserves values', sheetStats(xBack.sheet).values === stats.values);
expect('XLSX round-trip preserves colors', sheetStats(xBack.sheet).colors === stats.colors);

// 4) issue surfacing: a malformed row is reported (not silently dropped)
const dirty = parseDelimited('spec,מנוע\nbogusTag,x,y\ncolor,כחול,metallic,#0000ff');
const dres = cellsToSheet(dirty);
expect('unrecognised row surfaced as an issue', dres.issues.some((i) => /לא מזוהה/.test(i.message)));

// 5) map onto a REAL learned template
const tpl = learnTemplate([
  await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf'),
  await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf'),
]);
// Headless import carries no photos, so the learned template has no image slots. Inject a
// dynamic hero-image slot to exercise the manual-fallback reporting path deterministically.
tpl.pages[0].slots.push({
  id: 'hero_test', key: 'p1.hero-test', kind: 'hero-image', blockType: 'image', dynamic: true,
  bbox: { x: 40, y: 40, width: 220, height: 140 }, label: 'תמונת נושא ראשית',
  confidence: 1, variants: 1, crossDocEvidence: false,
});
const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
// a real measurer via the embedded font keeps auto-fit honest
const { PDFDocument } = await import('pdf-lib');
const fk = (await import('@pdf-lib/fontkit')).default;
const probe = await PDFDocument.create(); probe.registerFontkit(fk);
const probeFont = await probe.embedFont(fontBytes, { subset: false });
const measure = (t: string, s: number) => probeFont.widthOfTextAtSize(t, s);

const res = mapSheetToCatalog(tpl, sheet, { measure, title: 'בדיקת נתונים מובנים' });
expect('catalog has one page per template page', res.doc.pages.length === tpl.pages.length);

const allText = res.doc.pages.flatMap((p) => p.blocks.filter(isTextBlock));
expect('spec value from sheet present (453.5)', allText.some((b) => b.text.includes('453.5')));
expect('spec value from sheet present (1,199)', allText.some((b) => b.text.includes('1,199')));
expect('trim header GT present on spec page', allText.some((b) => b.text === 'GT'));
expect('section title rendered (מידות)', allText.some((b) => b.text.includes('מידות')));
expect('model-name mapped from sheet', res.mappings.some((m) => m.kind === 'model-name' && m.status === 'mapped'));
expect('marketing-text mapped from sheet', res.mappings.some((m) => m.kind === 'marketing-text' && m.status === 'mapped'));
expect('hero image surfaced for manual entry', res.manual.some((m) => m.kind === 'hero-image'));
const specMapped = res.mappings.find((m) => m.kind === 'spec');
expect('spec table reported as mapped', !!specMapped && specMapped.status === 'mapped');

// 6) REAL vector export of the populated catalog
const pdf = await exportPdf(res.doc, fontBytes);
const header = String.fromCharCode(...pdf.slice(0, 5));
expect('populated catalog exports to a real PDF', header === '%PDF-' && pdf.length > 5000);

console.log(`sheet: ${stats.rows} rows · ${stats.values} values · ${stats.features} features · ${stats.colors} colors`);
console.log(`mapped ${res.mappings.filter((m) => m.status === 'mapped').length} fields · ${res.manual.length} manual · ${res.warnings.length} warnings · PDF ${(pdf.length / 1024).toFixed(0)}KB`);
let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('ALL STRUCTURED-DATA CHECKS PASSED');
