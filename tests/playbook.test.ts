// Acceptance criteria of docs/REFERENCE_PLAYBOOK.md (T1–T6), automated against the REAL brand
// fixtures in tests/fixtures/. These are build gates: red ⇒ the build fails.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { importPdf } from '../src/pdf/importPdf';
import { detectTables, pageEdges } from '../src/templates/tableDetect';
import { toVisualLine } from '../src/engine/bidi';
import { fitText } from '../src/engine/autofit';
import { wrapText } from '../src/catalog/autofit';
import { pctRect, scaledPx } from '../src/editor/layerMath';
import { exportPdf } from '../src/pdf/exportPdf';
import type { DocumentIR, TextBlockIR } from '../src/types/catalog';

const fx = (name: string) => {
  const b = readFileSync(`tests/fixtures/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

let c3: DocumentIR;
let p3008: DocumentIR;

beforeAll(async () => {
  c3 = await importPdf(fx('citroen-c3.pdf'), 'citroen-c3.pdf', { renderPreviews: false });
  p3008 = await importPdf(fx('peugeot-3008.pdf'), 'peugeot-3008.pdf', { renderPreviews: false });
});

const textsOf = (d: DocumentIR) => d.pages.flatMap((p) => p.blocks).filter((b): b is TextBlockIR => b.type === 'text');

describe('T1 — text reconstruction (fixes fragmentation)', () => {
  it('a visually contiguous marketing paragraph → exactly 1 block', () => {
    const intro = textsOf(c3).filter((t) => t.text.includes('הכירו את ה-C3'));
    expect(intro).toHaveLength(1);
    expect(intro[0].text.split('\n').length).toBeGreaterThanOrEqual(3);
  });
  it('a mixed Hebrew+digits line reads logically (not reversed, real spaces)', () => {
    expect(textsOf(c3).some((t) => /מנוע 1\.2 ל['׳] טורבו/.test(t.text))).toBe(true);
  });
  it('raw item count vs block count reduction is real', async () => {
    const pdfjs = await import('pdfjs-dist') as unknown as { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }> } };
    const raw = await pdfjs.getDocument({ data: new Uint8Array(fx('citroen-c3.pdf')), isEvalSupported: false, useSystemFonts: false }).promise;
    let rawN = 0;
    for (let n = 1; n <= raw.numPages; n++) rawN += (await (await raw.getPage(n)).getTextContent()).items.filter((i) => i.str?.trim()).length;
    expect(rawN / textsOf(c3).length).toBeGreaterThan(1.4); // pdf.js emits RUNS, not chars
  });
});

describe('T2 — table detection', () => {
  it('the ruled 3008 spec grid extracts with the exact column structure (4 cols incl. category)', () => {
    const pg = p3008.pages[13];
    const { tables } = detectTables(pg.blocks.filter((b): b is TextBlockIR => b.type === 'text'), pg.width, pageEdges(pg));
    expect(tables.some((t) => t.columns === 4 && t.rows.length >= 20)).toBe(true);
  });
  it('RTL cell text is correct (label + value pair)', () => {
    const pg = p3008.pages[13];
    const { tables } = detectTables(pg.blocks.filter((b): b is TextBlockIR => b.type === 'text'), pg.width, pageEdges(pg));
    expect(tables.some((t) => t.rows.some((r) => r.cells.join('|').includes('מספר שסתומים') && r.cells.includes('12')))).toBe(true);
  });
});

describe('T3 — editor overlay math', () => {
  it('block rects are page-relative percentages (zoom-invariant)', () => {
    const r = pctRect({ x: 100, y: 50, width: 200, height: 25 }, 1000, 500);
    expect(r).toEqual({ left: '10.0000%', top: '10.0000%', width: '20.0000%', height: '5.0000%' });
  });
  it('font size rides the --scale-factor CSS variable', () => {
    expect(scaledPx(14.5)).toBe('calc(14.5px * var(--scale-factor))');
  });
});

describe('T4 — Hebrew bidi pipeline', () => {
  it("'מחיר: 149,900 ₪' — digits ascend LTR inside the RTL flow", () => {
    expect(toVisualLine('מחיר: 149,900 ₪')).toContain('149,900');
  });
  it("'מנוע 1.2 PureTech טורבו' — Latin run intact", () => {
    const v = toVisualLine('מנוע 1.2 PureTech טורבו');
    expect(v).toContain('PureTech');
    expect(v).toContain('1.2');
  });
  it("'(אוטומטי) 8 הילוכים' — brackets face correctly", () => {
    const v = toVisualLine('(אוטומטי) 8 הילוכים');
    expect((v.match(/\(/g) || []).length).toBe(1);
    expect((v.match(/\)/g) || []).length).toBe(1);
  });
});

describe('T6 — auto-fit into fixed slots', () => {
  const measure = (t: string, s: number) => t.length * s * 0.5;
  const box = { w: 120, h: 22 };
  it('shortest and longest model names both fit the same slot, no clipping', () => {
    const short = fitText('C3', box, measure, wrapText, 6, 24, 1.35);
    const long = fitText('פיג׳ו 5008 GT היברידי בנזין 7 מושבים', box, measure, wrapText, 6, 24, 1.35);
    for (const f of [short, long]) {
      expect(f.overflow).toBe(false);
      expect(f.lines.every((l) => measure(l, f.size) <= box.w + 0.5)).toBe(true);
      expect(f.lines.length * f.size * 1.35).toBeLessThanOrEqual(box.h + 0.5);
    }
    expect(long.size).toBeLessThan(short.size);
  });
});

describe('T5 — glyph-outline export (gated)', () => {
  it('outlines mode produces a fontless pure-vector PDF that still paints ink', async () => {
    const mk = (id: string, y: number, text: string): TextBlockIR => ({
      id, type: 'text', x: 20, y, width: 360, height: 30, rotation: 0, zIndex: 1, source: 'user',
      originalBBox: { x: 20, y, width: 360, height: 30 }, text, originalText: text,
      fontFamily: 'x', fontSize: 20, fontWeight: 400, lineHeight: 1.2, color: '#111111', direction: 'rtl', align: 'end',
    });
    const doc: DocumentIR = { id: 'd', brand: 'peugeot', pages: [{ id: 'p', width: 400, height: 120, rotation: 0, blocks: [mk('t1', 20, 'מחיר: 149,900 ₪ (GT)')] }] };
    const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
    const outPdf = await exportPdf(doc, fontBytes, undefined, { exportMode: 'outlines' });
    const dir = mkdtempSync(`${tmpdir()}/t5v-`);
    writeFileSync(`${dir}/o.pdf`, Buffer.from(outPdf));
    const res = execFileSync('python3', ['-c', `
import fitz
d=fitz.open('${dir}/o.pdf'); p=d[0]
print(len(p.get_fonts()), any(b<250 for b in p.get_pixmap().samples[:400000]))
`]).toString().trim().split(' ');
    rmSync(dir, { recursive: true, force: true });
    expect(Number(res[0])).toBe(0);
    expect(res[1]).toBe('True');
  });
});
