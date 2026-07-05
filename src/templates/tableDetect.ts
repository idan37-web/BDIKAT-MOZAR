// Root table reconstruction (Round 14): turn a dense page's positioned cells into whole TABLES
// (rows × columns), so template learning can emit ONE editable table slot per table instead of a
// box per cell/row. Built on the same RTL insight used for rows: a Hebrew LABEL column anchors a
// table and owns the VALUE columns to its reading-left, up to the next label column — which keeps
// two side-by-side tables separate even though their columns interleave in x.
import type { TextBlockIR, TableRowIR, TableBlockIR, PageIR, ShapeBlockIR } from '../types/catalog';

export interface DetectedTable {
  bbox: { x: number; y: number; width: number; height: number };
  columns: number;
  colFractions: number[]; // logical order, index 0 = label (rendered on the RIGHT in RTL)
  rows: TableRowIR[];
  rowHeight: number;
  fontSize: number;
  numeric: boolean; // values are mostly numbers/checkmarks (spec) vs feature text (equipment)
  color: string;
  fontFamily: string;
}

const HEB_WORD = /[֐-׿]{2,}/;
const isLabel = (t: string) => HEB_WORD.test(t);
const isNumericCell = (t: string) => {
  const s = t.trim();
  if (!s) return false;
  if (/^[vV✓✔√•·\-–—x×]$/.test(s)) return true; // checkmark / "has" marker / dash
  return /\d/.test(s) && (s.replace(/[\d.,/%+\-\s()x×]/gi, '').length <= 2);
};

interface Col { cells: TextBlockIR[]; x0: number; x1: number; label: boolean; anchor: number; n: number; }

/** Cluster cells into vertical COLUMNS by their RIGHT EDGE (the stable RTL anchor: labels and values
 * are right-aligned). The anchor is a running average so a column can't grow to swallow the page
 * (the bug when clustering against an expanding bbox). */
function toColumns(cells: TextBlockIR[], pageWidth: number): Col[] {
  const tol = Math.max(12, pageWidth * 0.02);
  const sorted = [...cells].sort((a, b) => (b.x + b.width) - (a.x + a.width)); // right→left
  const cols: Col[] = [];
  for (const c of sorted) {
    const r = c.x + c.width;
    const col = cols.find((k) => Math.abs(k.anchor - r) <= tol);
    if (col) {
      col.cells.push(c); col.x0 = Math.min(col.x0, c.x); col.x1 = Math.max(col.x1, c.x + c.width);
      col.anchor = (col.anchor * col.n + r) / (col.n + 1); col.n++;
    } else cols.push({ cells: [c], x0: c.x, x1: c.x + c.width, label: false, anchor: r, n: 1 });
  }
  for (const col of cols) {
    const labels = col.cells.filter((c) => isLabel(c.text)).length;
    col.label = labels >= col.cells.length * 0.5; // a column of Hebrew field names
  }
  return cols.sort((a, b) => b.x1 - a.x1); // right→left (label columns first)
}

/** Group columns into TABLES: reading right→left, each LABEL column starts a table and takes the
 * value columns to its left, up to the next label column. Leading value columns (no label yet) and
 * all-value pages fall back to one table. */
function groupTables(cols: Col[]): Col[][] {
  const tables: Col[][] = [];
  let cur: Col[] = [];
  for (const col of cols) { // already right→left
    if (col.label) { if (cur.length) tables.push(cur); cur = [col]; }
    else cur.push(col);
  }
  if (cur.length) tables.push(cur);
  return tables;
}

/** Reconstruct one table's rows from its columns. Columns are passed right→left; logical order
 * (index 0 = label) is right→left, which matches. */
function buildTable(tableCols: Col[]): DetectedTable | null {
  const all = tableCols.flatMap((c) => c.cells);
  if (all.length < 4) return null;
  const x0 = Math.min(...tableCols.map((c) => c.x0));
  const x1 = Math.max(...tableCols.map((c) => c.x1));
  const y0 = Math.min(...all.map((c) => c.y));
  const y1 = Math.max(...all.map((c) => c.y + c.height));
  const fonts = all.map((c) => c.fontSize).sort((a, b) => a - b);
  const fontSize = fonts[Math.floor(fonts.length / 2)] || 10;

  // rows = y-bands across the table's cells
  const bands: TextBlockIR[][] = [];
  for (const c of [...all].sort((a, b) => a.y - b.y)) {
    const band = bands.find((bd) => Math.abs(bd[0].y - c.y) < Math.min(bd[0].fontSize || 10, c.fontSize || 10) * 0.6);
    if (band) band.push(c); else bands.push([c]);
  }
  const cols = tableCols; // logical order (label first)
  const rows: TableRowIR[] = [];
  let numericVals = 0, totalVals = 0;
  for (const band of bands) {
    const cells: string[] = new Array(cols.length).fill('');
    for (const cell of band) {
      // assign by NEAREST RIGHT-EDGE ANCHOR — the same stable signal used to build the columns.
      // (Interval containment fails here: a wide label column's x-range swallows the value cells.)
      const r = cell.x + cell.width;
      let ci = 0, best = Infinity;
      for (let i = 0; i < cols.length; i++) {
        const d = Math.abs(cols[i].anchor - r);
        if (d < best) { best = d; ci = i; }
      }
      cells[ci] = cells[ci] ? `${cells[ci]} ${cell.text.trim()}` : cell.text.trim();
    }
    const labelCell = cells[0];
    const valueCells = cells.slice(1);
    const hasValues = valueCells.some((v) => v);
    if (labelCell && !hasValues && cols.length > 1) rows.push({ kind: 'section', cells: [labelCell] });
    else if (!labelCell && hasValues) rows.push({ kind: 'header', cells });
    else rows.push({ kind: 'data', cells });
    // numeric = value cells that carry actual NUMBERS (a checkmark-only grid is an equipment
    // list, not the technical spec — user-reported misclassification)
    for (const v of valueCells) if (v) { totalVals++; if (/\d/.test(v) && isNumericCell(v)) numericVals++; }
  }

  const totalW = x1 - x0 || 1;
  const colFractions = cols.map((c) => Math.max(0.08, (c.x1 - c.x0) / totalW));
  const fsum = colFractions.reduce((s, f) => s + f, 0);
  const normFrac = colFractions.map((f) => f / fsum);
  const rowHeight = Math.max(9, (y1 - y0) / Math.max(1, rows.length));
  return {
    bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    columns: cols.length,
    colFractions: normFrac,
    rows,
    rowHeight,
    fontSize,
    numeric: numericVals >= Math.max(3, totalVals * 0.3),
    color: mode(all.map((c) => c.color)),
    fontFamily: mode(all.map((c) => c.fontFamily)),
  };
}

function mode<T>(xs: T[]): T {
  const m = new Map<T, number>(); let best = xs[0], bc = 0;
  for (const x of xs) { const c = (m.get(x) || 0) + 1; m.set(x, c); if (c > bc) { bc = c; best = x; } }
  return best;
}

/**
 * Detect the tables on a dense page. Returns each table plus the cells it consumed, so the caller
 * can keep the remaining cells (headings, strays) as ordinary text regions.
 */
export function detectTables(cells: TextBlockIR[], pageWidth: number): { tables: DetectedTable[]; used: Set<string> } {
  const raw = cells.filter((c) => c.rotation === 0 && !c.deleted && c.text.trim());
  // exclude page TITLES/headings — a table cell is body-sized; a big title (e.g. "מפרט טכני") sits
  // above the grid and must stay a separate heading slot, not be swallowed as a table section row.
  const fs = raw.map((c) => c.fontSize).sort((a, b) => a - b);
  const medFont = fs[Math.floor(fs.length / 2)] || 10;
  const flat = raw.filter((c) => c.fontSize <= medFont * 1.8);
  let cols = toColumns(flat, pageWidth);
  // drop sparse OUTLIER columns (a real grid column has many stacked cells; scattered numbers like a
  // car's dimension callouts form 1-2-cell "columns" that would bloat a table's bbox over the image).
  cols = cols.filter((c) => c.cells.length >= 3);
  const groups = groupTables(cols);
  const tables: DetectedTable[] = [];
  const used = new Set<string>();
  for (const g of groups) {
    const t = buildTable(g);
    // a real table has multiple rows AND (multiple columns OR a long single-column list)
    if (t && t.rows.length >= 3 && (t.columns >= 2 || t.rows.length >= 6)) {
      tables.push(t);
      for (const col of g) for (const c of col.cells) used.add(c.id);
    }
  }
  return { tables, used };
}

const lum = (hex?: string) => { const m = /^#(..)(..)(..)$/.exec(hex || ''); if (!m) return 1; const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const bboxOverlapFrac = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy, area = a.width * a.height;
  return area > 0 ? inter / area : 0;
};

/** Build a TableBlockIR from a detected table (shared by import reconstruction + generation). */
export function detectedToTableBlock(t: DetectedTable, id: string, sectionBg?: string): TableBlockIR {
  return {
    id, type: 'table',
    x: t.bbox.x, y: t.bbox.y, width: t.bbox.width, height: t.bbox.height,
    rotation: 0, zIndex: 500_000, source: 'original',
    originalBBox: { ...t.bbox },
    columns: t.columns, colFractions: t.colFractions, rows: t.rows,
    rowHeight: t.rowHeight, fontFamily: t.fontFamily || 'sans-serif', fontSize: t.fontSize,
    color: t.color || '#111418', gridColor: '#d7dade', cellBg: '#ffffff', sectionBg,
    direction: 'rtl',
  };
}

/**
 * IMPORT-TIME reconstruction: replace a dense page's raw table cells with clean editable
 * TableBlockIR objects, and drop the coloured SECTION-BAND shapes that fall inside a table (the
 * table now paints its own white cells + a captured section-header colour) — this is what removes
 * the "yellow band bleeds over the whole table" artefact in the editor. Non-table content is kept.
 */
export function reconstructTables(page: PageIR): void {
  const texts = page.blocks.filter((b): b is TextBlockIR => b.type === 'text');
  if (texts.length < 20) return; // only dense pages
  const { tables, used } = detectTables(texts, page.width);
  if (!tables.length) return;

  const shapes = page.blocks.filter((b): b is ShapeBlockIR => b.type === 'shape' || b.type === 'background');
  const keep: typeof page.blocks = [];
  const removedBandColors: string[] = [];
  for (const b of page.blocks) {
    if (b.type === 'text' && used.has(b.id)) continue; // consumed into a table
    if ((b.type === 'shape' || b.type === 'background') && (b as ShapeBlockIR).fill) {
      const s = b as ShapeBlockIR;
      const thinLine = Math.min(s.width, s.height) <= 3; // a gridline/rule, not a fill band
      const insideTable = tables.some((t) => bboxOverlapFrac({ x: s.x, y: s.y, width: s.width, height: s.height }, t.bbox) > 0.6);
      // a coloured (non-white) band inside a table is a section highlight → drop it (the table
      // renders it), and remember its colour so the table can reproduce the section background.
      if (insideTable && !thinLine && lum(s.fill) < 0.95) { removedBandColors.push(s.fill!); continue; }
      if (insideTable && !thinLine && lum(s.fill) >= 0.95) continue; // white cell fills → table paints its own
    }
    keep.push(b);
  }
  const sectionBg = removedBandColors.length ? mode(removedBandColors) : undefined;
  tables.forEach((t, i) => keep.push(detectedToTableBlock(t, `${page.id}_tbl${i}`, sectionBg)));
  page.blocks = keep;
  void shapes;
}
