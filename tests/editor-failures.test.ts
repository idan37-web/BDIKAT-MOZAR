// @vitest-environment jsdom
// Round-18 user-reported editor failures (F1..). Protocol: each test was written RED against
// the failing build, then the app code was fixed until green. Tests are never edited to pass.
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PageView } from '../src/app/PageView';
import type { PageIR, TextBlockIR } from '../src/types/catalog';

function renderPage(page: PageIR, extraProps: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(PageView, {
      page, scale: 1, mode: 'editable',
      ...extraProps,
    } as never));
  });
  return host;
}

const textBlock = (id: string, text: string, over: Partial<TextBlockIR> = {}): TextBlockIR => ({
  id, type: 'text', x: 40, y: 40, width: 200, height: 30, rotation: 0, zIndex: 1, source: 'original',
  originalBBox: { x: 40, y: 40, width: 200, height: 30 },
  text, originalText: text, fontFamily: 'sans-serif', fontSize: 12, fontWeight: 400,
  lineHeight: 1.2, color: '#111111', direction: 'rtl', align: 'end', ...over,
});

describe('F3 — letter-spaced text must not split into characters (statistical gap classification)', () => {
  it('the dealer strip reconstructs real words — phones contiguous, no single-character-word soup', async () => {
    const { readFileSync } = await import('node:fs');
    const { importPdf } = await import('../src/pdf/importPdf');
    const b = readFileSync('tests/fixtures/c3-dealer-strip.pdf');
    const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 's.pdf', { renderPreviews: false });
    const texts = doc.pages[0].blocks.filter((bl) => bl.type === 'text') as TextBlockIR[];
    // a phone number is ONE token (letter-spacing gaps are not word gaps)
    expect(texts.some((t) => t.text.includes('03-6710354')), 'phone number must reconstruct contiguously').toBe(true);
    // the strip as a whole is words, not characters
    const words = texts.flatMap((t) => t.text.split(/\s+/)).filter(Boolean);
    const singles = words.filter((w) => [...w].length === 1 && !/[0-9|]/.test(w)).length;
    expect(singles / words.length, `single-char words ratio too high (${singles}/${words.length})`).toBeLessThan(0.1);
  }, 240_000);

  it('normal paragraphs keep their spacing (C3 intro paragraph words intact)', async () => {
    const { readFileSync } = await import('node:fs');
    const { importPdf } = await import('../src/pdf/importPdf');
    const b = readFileSync('tests/fixtures/citroen-c3.pdf');
    const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'c3.pdf', { renderPreviews: false });
    const texts = doc.pages.flatMap((p) => p.blocks).filter((bl) => bl.type === 'text') as TextBlockIR[];
    const intro = texts.find((t) => t.text.includes('הכירו את ה-C3'));
    expect(intro, 'intro paragraph must exist with normal word spacing').toBeTruthy();
    expect(intro!.text).toMatch(/רכב קומפקטי שמביא/);
  }, 240_000);
});

describe('F1 — clipped text in blocks (edit mode must auto-grow + indicate overflow)', () => {
  // ~9 wrapped lines at width 200/size 12 with the injected measure → 3x the 30pt box
  const longText = 'מלל ארוך מאוד שנמשך ונמשך וממשיך הרבה מעבר לגובה התיבה המקורית של הבלוק הזה '.repeat(3);
  const measureText = (t: string, _fam: string, _w: number, px: number) => t.length * px * 0.55;

  it('a text block with 3x overflowing content is NOT clipped in edit mode (auto-grow, min-height = bbox)', () => {
    const page: PageIR = { id: 'p', width: 600, height: 400, rotation: 0, blocks: [textBlock('t1', longText)] };
    const host = renderPage(page, { measureText });
    // innermost matching div = the block element itself (the page CONTAINER also "contains" the
    // text via textContent, so document-order .find() would grab the wrong element)
    const el = [...host.querySelectorAll('div')].filter((d) => d.textContent?.includes('מלל ארוך')).pop() as HTMLElement;
    expect(el, 'text block did not render').toBeTruthy();
    // auto-grow contract: no fixed height clamp + no hidden overflow in EDIT mode
    expect(el.style.height, 'edit mode must not hard-clamp block height').toBe('auto');
    expect(el.style.minHeight, 'template bbox must remain the minimum height').not.toBe('');
    expect(el.style.overflow, 'edit mode must not hide overflowing text').not.toBe('hidden');
  });

  it('an overflowing block shows a visible overflow indicator (nothing silently hidden)', () => {
    const page: PageIR = { id: 'p', width: 600, height: 400, rotation: 0, blocks: [textBlock('t1', longText)] };
    const host = renderPage(page, { measureText });
    expect(host.querySelector('[data-overflow="true"]'), 'expected a visible overflow indicator').toBeTruthy();
  });

  it('a fitting block shows NO indicator and keeps its box', () => {
    const page: PageIR = { id: 'p', width: 600, height: 400, rotation: 0, blocks: [textBlock('t2', 'שורה קצרה')] };
    const host = renderPage(page, { measureText });
    expect(host.querySelector('[data-overflow="true"]')).toBeNull();
  });
});

describe('F4 — table detection: a faithful grid or clean text, never a broken table', () => {
  async function importFixture(name: string) {
    const { readFileSync } = await import('node:fs');
    const { importPdf } = await import('../src/pdf/importPdf');
    const b = readFileSync(`tests/fixtures/${name}`);
    return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), name, { renderPreviews: false, reconstructTables: true });
  }
  type TableBlockIR = import('../src/types/catalog').TableBlockIR;

  it('the C3 spec page is a faithful grid — real spec pairs align, footnotes/title are NOT swallowed as rows', async () => {
    const doc = await importFixture('c3-spec-page.pdf');
    const page = doc.pages[0];
    const tables = page.blocks.filter((b) => b.type === 'table') as TableBlockIR[];
    expect(tables.length, 'the spec page must reconstruct at least one table').toBeGreaterThan(0);

    const rowCells = tables.flatMap((t) => t.rows.flatMap((r) => r.cells)).map((c) => c.trim());
    // a footnote ("*המוקדם מביניהם.", "**נתוני צריכת הדלק…") is NOT table data — swallowing it as a
    // section row is the "broken table" symptom. It must degrade to a free-text block instead.
    expect(rowCells.filter((c) => /^\*/.test(c)), 'footnote lines must not become table rows').toEqual([]);
    // the page TITLE ("מפרט טכני …") is a heading, never a table cell
    expect(rowCells.some((c) => c.includes('מפרט טכני')), 'the page title must not be a table row').toBe(false);

    // faithfulness: known label→value pairs line up in the grid (label in col 0, value in col 1)
    const pairValue = (labelPart: string): string | undefined => {
      for (const t of tables) for (const r of t.rows) {
        if (r.kind === 'data' && r.cells[0]?.includes(labelPart)) return r.cells[1]?.trim();
      }
      return undefined;
    };
    expect(pairValue('גובה'), 'height row value').toBe('159');
    expect(pairValue('מכל דלק'), 'fuel-tank row value').toBe('44');
    expect(pairValue('מהירות מרבית'), 'top-speed row value').toBe('160');

    // the swallowed footnote text must survive as a free-text block on the page
    const texts = page.blocks.filter((b) => b.type === 'text') as { text: string }[];
    expect(texts.some((t) => t.text.includes('המוקדם מביניהם')), 'footnote must remain as free text').toBe(true);
  }, 240_000);

  it('the multi-column trim comparison page keeps its grid (no regression)', async () => {
    const doc = await importFixture('peugeot-3008.pdf');
    const tables = doc.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'table') as TableBlockIR[];
    // the trim-comparison page is a wide checkmark grid — the fix must NOT collapse it to text
    expect(tables.some((t) => t.columns >= 4 && t.rows.length >= 10),
      'a 4+ column trim comparison table must still be detected').toBe(true);
  }, 240_000);
});

describe('F5 — table cell vertical alignment (default middle; per-table + per-row control, editor==export)', () => {
  type TableBlockIR = import('../src/types/catalog').TableBlockIR;
  type CellVAlign = import('../src/types/catalog').CellVAlign;
  const tallTable = (over: Partial<TableBlockIR> = {}, rowOver: Record<string, unknown> = {}): TableBlockIR => ({
    id: 'tb', type: 'table', x: 40, y: 40, width: 200, height: 90, rotation: 0, zIndex: 1, source: 'original',
    originalBBox: { x: 40, y: 40, width: 200, height: 90 },
    columns: 2, colFractions: [0.6, 0.4], rowHeight: 90,
    rows: [{ kind: 'data', cells: ['גובה', '159'], ...rowOver }],
    fontFamily: 'sans-serif', fontSize: 12, color: '#111418', direction: 'rtl', ...over,
  } as TableBlockIR);

  const valueCellAlign = (t: TableBlockIR): string => {
    const page: PageIR = { id: 'p', width: 600, height: 400, rotation: 0, blocks: [t] };
    const host = renderPage(page);
    const el = [...host.querySelectorAll('div')].filter((d) => d.textContent?.trim() === '159').pop() as HTMLElement;
    expect(el, 'value cell 159 did not render').toBeTruthy();
    return el.style.alignItems;
  };

  it('editor: default is middle; per-table vAlign and a per-row override both move the cell', () => {
    expect(valueCellAlign(tallTable()), 'default must be middle (center)').toBe('center');
    expect(valueCellAlign(tallTable({ vAlign: 'top' as CellVAlign })), 'per-table top').toBe('flex-start');
    expect(valueCellAlign(tallTable({ vAlign: 'bottom' as CellVAlign })), 'per-table bottom').toBe('flex-end');
    // a per-ROW vAlign overrides the per-table default
    expect(valueCellAlign(tallTable({ vAlign: 'top' as CellVAlign }, { vAlign: 'bottom' })), 'per-row override wins').toBe('flex-end');
  });

  it('export: the drawn value baseline follows vAlign (top highest on the page, bottom lowest)', async () => {
    const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const { tmpdir } = await import('node:os');
    const { exportPdf } = await import('../src/pdf/exportPdf');
    const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
    const glyphY = async (v: CellVAlign): Promise<number> => {
      const doc = { id: 'd', pages: [{ id: 'p', width: 600, height: 400, rotation: 0, blocks: [tallTable({ vAlign: v })] }] };
      const pdf = await exportPdf(doc as never, fontBytes);
      const dir = mkdtempSync(`${tmpdir()}/f5-`);
      writeFileSync(`${dir}/e.pdf`, Buffer.from(pdf));
      const out = execFileSync('python3', ['-c', `
import fitz
d=fitz.open('${dir}/e.pdf'); pg=d[0]; ys=[]
for b in pg.get_text('rawdict')['blocks']:
  for l in b.get('lines',[]):
    for s in l.get('spans',[]):
      for ch in s.get('chars',[]):
        if ch['c'] in '159':
          x0,y0,x1,y1=ch['bbox']; ys.append((y0+y1)/2)
print(min(ys) if ys else -1)
`]).toString();
      return parseFloat(out.trim());
    };
    const yTop = await glyphY('top'), yMid = await glyphY('middle'), yBot = await glyphY('bottom');
    expect(yTop, 'top glyph must sit above middle').toBeLessThan(yMid - 5);
    expect(yBot, 'bottom glyph must sit below middle').toBeGreaterThan(yMid + 5);
  }, 120_000);
});
