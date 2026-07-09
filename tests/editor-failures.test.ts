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
