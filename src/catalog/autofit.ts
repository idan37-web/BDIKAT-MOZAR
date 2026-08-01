// Milestone B: generation-time auto-fit. Auto-generated pages must not come out broken,
// so before opening/exporting we MEASURE each text block against its box and, in order:
// shrink the font to a floor → wrap → grow the box within page bounds → else flag.
// RTL is preserved (wrapping is on words in logical order; visual order is applied later).
import type { DocumentIR, TextBlockIR, TableBlockIR } from '../types/catalog';
import { isTextBlock } from '../types/catalog';
import { fitText } from '../engine/autofit';

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
  // T6 (playbook): binary-search the largest size in [floor, design] whose logically-wrapped
  // lines fit the box (per-line VISUAL width via bidi) — replaces the linear shrink loop.
  const fit = fitText(b.text, { w: b.width, h: b.height }, measure, wrapText, floor, b.fontSize, lh);
  if (!fit.overflow) return { fontSize: fit.size, height: b.height, lines: fit.lines, overflow: false };
  // at the floor: grow the box downward within the page
  const lines = wrapText(b.text, b.width, floor, measure);
  const needed = lines.length * floor * lh;
  const room = maxBottom - b.y;
  if (needed <= room + 0.5) return { fontSize: floor, height: needed, lines, overflow: false };
  return { fontSize: floor, height: Math.max(b.height, room), lines, overflow: true }; // flagged
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

/** Measure cell text at a weight — used to fit a table's font so no cell clips. */
export type CellMeasure = (text: string, fontSize: number, bold: boolean) => number;

/** F6 minimum readable table font, as a fraction of the design size — below this the row GROWS
 * (text wraps) rather than shrinking to an unreadable size. */
export const CELL_MIN_FONT_RATIO = 0.7;

/**
 * F6: fit ONE cell's text to its box. Shrink the font toward the readable floor to keep it on a
 * single line; if it still overflows at the floor, WRAP (the caller grows the row). Pure — shared
 * by the PDF export and the model-level table fit so they never disagree.
 */
export function fitCell(
  text: string, cellW: number, baseFont: number, measure: Measure,
  minFont = Math.max(5, baseFont * CELL_MIN_FONT_RATIO), maxLines = 3,
): { fontSize: number; lines: string[] } {
  if (!text.trim() || cellW <= 0) return { fontSize: baseFont, lines: [text] };
  let s = baseFont;
  while (s > minFont && measure(text, s) > cellW) s = Math.max(minFont, Math.round((s - 0.25) * 100) / 100);
  if (measure(text, s) <= cellW) return { fontSize: s, lines: [text] };
  // still too wide at the floor → wrap at the floor font (row must grow to hold the lines)
  const lines = wrapLine(text, cellW, minFont, measure).slice(0, maxLines);
  return { fontSize: minFont, lines };
}

/**
 * F6: fit a table so EVERY cell shows its text. Per cell, shrink the font toward the readable floor
 * (CELL_MIN_FONT_RATIO); when a cell still overflows at the floor, the row GROWS to fit the wrapped
 * lines instead of shrinking the font into illegibility. Mutates the table. Returns true if changed.
 */
export function fitTableBlock(t: TableBlockIR, measure: CellMeasure, padding = 6): boolean {
  const minFont = Math.max(5, Math.round(t.fontSize * CELL_MIN_FONT_RATIO * 10) / 10);
  const cells: { txt: string; bold: boolean; colW: number }[] = [];
  for (const row of t.rows) {
    if (row.kind === 'section') { cells.push({ txt: row.cells[0] || '', bold: true, colW: t.width - padding * 2 }); continue; }
    const bold = row.kind === 'header';
    for (let c = 0; c < t.columns; c++) {
      const txt = row.cells[c] || '';
      if (!txt) continue;
      const colW = (t.colFractions[c] || 0) * t.width - padding * 2;
      if (colW > 0) cells.push({ txt, bold, colW });
    }
  }
  // 1) shrink the shared font to fit the tightest cell, but never below the readable floor
  let scale = 1;
  for (const cw of cells) { const w = measure(cw.txt, t.fontSize, cw.bold); if (w > cw.colW) scale = Math.min(scale, cw.colW / w); }
  const newFont = scale < 1 ? Math.max(minFont, Math.round(t.fontSize * scale * 10) / 10) : t.fontSize;
  // 2) any cell that STILL overflows at the floored font must wrap → grow the row to hold the lines
  let maxLines = 1;
  for (const cw of cells) {
    const w = measure(cw.txt, newFont, cw.bold);
    if (w > cw.colW && cw.colW > 0) maxLines = Math.max(maxLines, Math.min(3, Math.ceil(w / cw.colW)));
  }
  const newRow = Math.max(t.rowHeight, Math.ceil(newFont * 1.5 * maxLines));
  const changed = newFont !== t.fontSize || newRow !== t.rowHeight;
  t.fontSize = newFont;
  t.rowHeight = newRow;
  t.height = t.rows.length * t.rowHeight;
  return changed;
}
