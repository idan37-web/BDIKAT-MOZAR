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
