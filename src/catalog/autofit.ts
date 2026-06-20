// Milestone B: generation-time auto-fit. Auto-generated pages must not come out broken,
// so before opening/exporting we MEASURE each text block against its box and, in order:
// shrink the font to a floor → wrap → grow the box within page bounds → else flag.
// RTL is preserved (wrapping is on words in logical order; visual order is applied later).
import type { DocumentIR, TextBlockIR } from '../types/catalog';
import { isTextBlock } from '../types/catalog';

/** Width of `text` at `fontSize`, in the SAME units as the box (PDF points). */
export type Measure = (text: string, fontSize: number) => number;

/** Greedy word-wrap one logical line to `maxWidth`; hard-breaks an over-long word. */
export function wrapLine(text: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  if (!text) return [''];
  if (maxWidth <= 0 || measure(text, fontSize) <= maxWidth) return [text];
  const tokens = text.split(/(\s+)/); // keep whitespace tokens so spacing is preserved
  const lines: string[] = [];
  let cur = '';
  const pushBrokenWord = (word: string): string => {
    // break a single token longer than the box into box-width pieces
    let rest = word;
    while (measure(rest, fontSize) > maxWidth && rest.length > 1) {
      let fit = 1;
      for (let k = 1; k <= rest.length; k++) { if (measure(rest.slice(0, k), fontSize) <= maxWidth) fit = k; else break; }
      lines.push(rest.slice(0, fit));
      rest = rest.slice(fit);
    }
    return rest;
  };
  for (const tok of tokens) {
    if (!tok) continue;
    const candidate = cur + tok;
    if (!cur.trim() || measure(candidate.trimEnd(), fontSize) <= maxWidth) {
      cur = candidate;
    } else {
      lines.push(cur.trimEnd());
      cur = tok.replace(/^\s+/, '');
    }
    if (measure(cur.trimEnd(), fontSize) > maxWidth && !/\s/.test(cur.trim())) {
      cur = pushBrokenWord(cur.trim());
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [''];
}

/** Wrap a block's text (honouring explicit newlines) to `maxWidth`. */
export function wrapText(text: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  return text.split('\n').flatMap((l) => wrapLine(l, maxWidth, fontSize, measure));
}

export interface FitResult { fontSize: number; height: number; lines: string[]; overflow: boolean; }

/**
 * Fit one text block: shrink to `minScale`×design, then (always wrapped) grow the box down
 * within page bounds, else report overflow. Underflow is left as-is (visually balanced).
 */
export function fitTextBlock(b: TextBlockIR, measure: Measure, pageHeight: number, minScale = 0.85): FitResult {
  const lh = b.lineHeight || 1.2;
  const floor = Math.max(5, b.fontSize * minScale);
  const maxBottom = pageHeight - 6;
  let size = b.fontSize;
  for (;;) {
    const lines = wrapText(b.text, b.width, size, measure);
    const needed = lines.length * size * lh;
    if (needed <= b.height + 0.5) return { fontSize: size, height: b.height, lines, overflow: false };
    if (size > floor) { size = Math.max(floor, Math.round((size - 0.5) * 10) / 10); continue; }
    // at the floor: grow the box downward within the page
    const room = maxBottom - b.y;
    if (needed <= room + 0.5) return { fontSize: size, height: needed, lines, overflow: false };
    return { fontSize: size, height: Math.max(b.height, room), lines, overflow: true }; // flagged
  }
}

export interface AutofitWarning { pageId: string; blockId: string; msg: string; }

/**
 * Auto-fit every text block in the document. `measureFor(b)` returns a measurer bound to
 * that block's font/weight (canvas in the browser, pdf-lib in verification). Mutates blocks
 * (fontSize/height) and returns warnings for blocks that still overflow at the floor size.
 */
export function autofitDocument(
  doc: DocumentIR,
  measureFor: (b: TextBlockIR) => Measure,
  minScale = 0.85,
): { warnings: AutofitWarning[] } {
  const warnings: AutofitWarning[] = [];
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (!isTextBlock(b)) continue;
      const r = fitTextBlock(b, measureFor(b), page.height, minScale);
      b.fontSize = r.fontSize;
      b.height = r.height;
      if (r.overflow) warnings.push({ pageId: page.id, blockId: b.id, msg: `text overflows its box even at ${Math.round(minScale * 100)}% size` });
    }
  }
  return { warnings };
}

/** Browser measurer factory: one shared canvas, font set per block. */
export function canvasMeasureFor(fontFamily: string): (b: TextBlockIR) => Measure {
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = cv?.getContext('2d') || null;
  return (b: TextBlockIR) => (text: string, fontSize: number) => {
    if (!ctx) return text.length * fontSize * 0.5; // crude fallback
    ctx.font = `${b.fontWeight || 400} ${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };
}
