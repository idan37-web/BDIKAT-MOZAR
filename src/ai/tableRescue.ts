// Table rescue (contract §4): when tableDetect's confidence is below threshold, the model may
// return the table's LOGICAL structure ONLY (matrix of cell texts + header rows + colspans).
// Geometry is recovered HERE, by aligning each returned cell text to the extractor's words —
// the model never outputs coordinates. If fewer than 90% of the non-empty cells align, the
// caller keeps the existing degradation to clean text blocks.
import type { TextBlockIR } from '../types/catalog';
import type { TableRowIR } from '../types/catalog';
import type { SlotTable } from '../templates/templateSpec';
import type { TableRescue } from './semanticSchema';

export const RESCUE_ALIGN_MIN = 0.9;

/** Normalize for text matching: collapse whitespace/NBSP, unify quote familes and dashes —
 * the same equivalence classes the F2 oracle uses (font cmap quirks are not identity). */
export const normCell = (s: string) => [...s]
  .map((c) => (' ⁦⁩'.includes(c) ? ' ' : "'\"׳״`".includes(c) ? "'" : '–—'.includes(c) ? '-' : c))
  .join('')
  .replace(/\s+/g, ' ')
  .trim();

export interface AlignedCell { r: number; c: number; text: string; bbox: { x: number; y: number; width: number; height: number } }
export interface RescueAlignment {
  /** matched fraction of NON-EMPTY cells (gate at RESCUE_ALIGN_MIN). */
  rate: number;
  cells: AlignedCell[];
  /** measured table geometry (only meaningful when rate >= RESCUE_ALIGN_MIN). */
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * Align the model's cell texts to the extractor's words inside the region. Match order per cell:
 * exact normalized block; a block containing the cell text (or contained by it); the concatenation
 * of same-row-band consecutive blocks. Each block is consumed at most once.
 */
export function alignRescuedCells(rescue: TableRescue, words: TextBlockIR[]): RescueAlignment {
  const pool = words
    .filter((w) => !w.deleted && w.text.trim())
    .map((w) => ({ w, norm: normCell(w.text), used: false }));
  const cells: AlignedCell[] = [];
  let nonEmpty = 0;
  let matched = 0;

  for (let r = 0; r < rescue.rows.length; r++) {
    for (let c = 0; c < rescue.rows[r].length; c++) {
      const want = normCell(rescue.rows[r][c] || '');
      if (!want) continue;
      nonEmpty++;
      // 1) exact single-block match
      let hit = pool.find((p) => !p.used && p.norm === want);
      // 2) containment either way (>=70% length overlap so "44" can't hit "1,440")
      if (!hit) {
        hit = pool.find((p) => !p.used && (
          (p.norm.includes(want) && want.length >= p.norm.length * 0.7) ||
          (want.includes(p.norm) && p.norm.length >= want.length * 0.7)));
      }
      if (hit) {
        hit.used = true;
        matched++;
        cells.push({ r, c, text: rescue.rows[r][c], bbox: { x: hit.w.x, y: hit.w.y, width: hit.w.width, height: hit.w.height } });
        continue;
      }
      // 3) concatenation of unused blocks in one y-band whose joined text equals the cell
      const bands = new Map<number, typeof pool>();
      for (const p of pool) {
        if (p.used) continue;
        const band = Math.round(p.w.y / Math.max(6, p.w.fontSize));
        (bands.get(band) || bands.set(band, []).get(band)!).push(p);
      }
      let done = false;
      for (const band of bands.values()) {
        // RTL reading order: right→left
        const orderedBand = [...band].sort((a, b) => (b.w.x + b.w.width) - (a.w.x + a.w.width));
        for (let i = 0; i < orderedBand.length && !done; i++) {
          let acc = '';
          const parts: typeof pool = [];
          for (let j = i; j < orderedBand.length; j++) {
            acc = acc ? `${acc} ${orderedBand[j].norm}` : orderedBand[j].norm;
            parts.push(orderedBand[j]);
            if (acc === want) {
              parts.forEach((p) => { p.used = true; });
              matched++;
              const x0 = Math.min(...parts.map((p) => p.w.x));
              const y0 = Math.min(...parts.map((p) => p.w.y));
              const x1 = Math.max(...parts.map((p) => p.w.x + p.w.width));
              const y1 = Math.max(...parts.map((p) => p.w.y + p.w.height));
              cells.push({ r, c, text: rescue.rows[r][c], bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
              done = true;
              break;
            }
            if (acc.length > want.length) break;
          }
        }
        if (done) break;
      }
    }
  }

  const bbox = cells.length ? {
    x: Math.min(...cells.map((c) => c.bbox.x)),
    y: Math.min(...cells.map((c) => c.bbox.y)),
    width: Math.max(...cells.map((c) => c.bbox.x + c.bbox.width)) - Math.min(...cells.map((c) => c.bbox.x)),
    height: Math.max(...cells.map((c) => c.bbox.y + c.bbox.height)) - Math.min(...cells.map((c) => c.bbox.y)),
  } : { x: 0, y: 0, width: 0, height: 0 };

  return { rate: nonEmpty ? matched / nonEmpty : 0, cells, bbox };
}

/** Build a SlotTable from an accepted alignment (geometry measured from the matched cells). */
export function rescuedToSlotTable(
  rescue: TableRescue, align: RescueAlignment,
  style: { fontSize: number; color: string; fontFamily: string },
): SlotTable {
  const nCols = Math.max(1, ...rescue.rows.map((r) => r.length));
  const headerSet = new Set(rescue.headerRows);
  const spanOf = new Map<number, number>(); // row → span (full-width section rows)
  for (const [r, c, span] of rescue.colspans || []) { if (c === 0 && span >= nCols) spanOf.set(r, span); }
  const rows: TableRowIR[] = rescue.rows.map((cells, r) => {
    if (spanOf.has(r) || (cells.filter((x) => x.trim()).length === 1 && cells[0]?.trim() && rescue.rows.length > 2 && !headerSet.has(r)))
      return { kind: 'section', cells: [cells.find((x) => x.trim()) || ''] };
    if (headerSet.has(r)) return { kind: 'header', cells };
    return { kind: 'data', cells };
  });
  // column fractions from matched cell x-extents (logical col 0 = rightmost on the page)
  const colX: { x0: number; x1: number }[] = Array.from({ length: nCols }, () => ({ x0: Infinity, x1: -Infinity }));
  for (const c of align.cells) {
    const k = colX[Math.min(c.c, nCols - 1)];
    k.x0 = Math.min(k.x0, c.bbox.x);
    k.x1 = Math.max(k.x1, c.bbox.x + c.bbox.width);
  }
  const total = align.bbox.width || 1;
  const fracs = colX.map((k) => (k.x1 > k.x0 ? Math.max(0.06, (k.x1 - k.x0) / total) : 1 / nCols));
  const fsum = fracs.reduce((s, f) => s + f, 0);
  return {
    columns: nCols,
    colFractions: fracs.map((f) => f / fsum),
    rows,
    rowHeight: Math.max(9, align.bbox.height / Math.max(1, rows.length)),
    fontSize: style.fontSize,
    color: style.color,
    fontFamily: style.fontFamily,
  };
}
