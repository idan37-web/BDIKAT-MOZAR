// Root table reconstruction (Round 14): turn a dense page's positioned cells into whole TABLES
// (rows × columns), so template learning can emit ONE editable table slot per table instead of a
// box per cell/row. Built on the same RTL insight used for rows: a Hebrew LABEL column anchors a
// table and owns the VALUE columns to its reading-left, up to the next label column — which keeps
// two side-by-side tables separate even though their columns interleave in x.
import type { TextBlockIR, TableRowIR, TableBlockIR, PageIR, ShapeBlockIR } from '../types/catalog';
import { detectGridTables, gridCellText, type Edge, type GridTable } from '../engine/gridDetect';

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
  /** F4: 0..1 grid regularity. Below CONFIDENCE_MIN the caller degrades the region to clean text
   * blocks instead of emitting a broken table. */
  confidence: number;
  /** F4: ids of the cells actually placed in the KEPT rows — the caller marks only these consumed,
   * so trimmed strays (footnotes, prose paragraphs) survive as free text. */
  consumedIds: string[];
}

/** F4: minimum grid regularity to emit a table; a lower score degrades to clean text. */
export const CONFIDENCE_MIN = 0.5;

/** A label-only row that is NOT a real section header — a footnote ("*…"), a prose paragraph, or a
 * trailing category with no data beneath it. Such rows are stripped from the grid and returned to
 * free text (the "broken table swallowed the footnotes" symptom). */
function isStraySection(text: string, followedByData: boolean): boolean {
  const t = text.trim();
  if (/^\*/.test(t)) return true;                       // footnote marker
  if (t.split(/\s+/).length >= 6) return true;          // a sentence/paragraph, not a category label
  return !followedByData;                               // trailing header with nothing under it
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
  // build rows AND keep each row's source cells, so a trimmed stray returns to free text
  const raw: { row: TableRowIR; cells: TextBlockIR[] }[] = [];
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
    let row: TableRowIR;
    if (labelCell && !hasValues && cols.length > 1) row = { kind: 'section', cells: [labelCell] };
    else if (!labelCell && hasValues) row = { kind: 'header', cells };
    else row = { kind: 'data', cells };
    raw.push({ row, cells: band });
  }

  // F4: strip stray label-only rows (footnotes / prose / trailing categories) — they are NOT grid
  // data; keep them out of the table so they degrade to free text. A section is real only when a
  // data row appears somewhere below it.
  const kept = raw.filter((e, i) => {
    if (e.row.kind !== 'section') return true;
    const followedByData = raw.slice(i + 1).some((n) => n.row.kind === 'data');
    return !isStraySection(e.row.cells[0] || '', followedByData);
  });
  if (!kept.length) return null;

  const rows = kept.map((e) => e.row);
  let numericVals = 0, totalVals = 0, coherent = 0;
  for (const { row } of kept) {
    if (row.kind === 'data') {
      const vals = row.cells.slice(1).filter((v) => v);
      if (row.cells[0] && vals.length) coherent++;
      for (const v of vals) { totalVals++; if (/\d/.test(v) && isNumericCell(v)) numericVals++; }
    } else coherent++; // section (now guaranteed to head data) / header
  }
  const confidence = coherent / rows.length;

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
    confidence,
    consumedIds: kept.flatMap((e) => e.cells.map((c) => c.id)),
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
export function detectTables(cells: TextBlockIR[], pageWidth: number, edges?: Edge[]): { tables: DetectedTable[]; used: Set<string>; rejected: DetectedTable[] } {
  const raw = cells.filter((c) => c.rotation === 0 && !c.deleted && c.text.trim());
  // exclude page TITLES/headings — a table cell is body-sized; a big title (e.g. "מפרט טכני") sits
  // above the grid and must stay a separate heading slot, not be swallowed as a table section row.
  // Also exclude PARAGRAPH blocks (multi-line / tall): a paragraph is ONE unit and must never be
  // chopped into table rows — the root of the "marketing copy became a bordered table" regression.
  const fs = raw.map((c) => c.fontSize).sort((a, b) => a - b);
  const medFont = fs[Math.floor(fs.length / 2)] || 10;
  let flat = raw.filter((c) =>
    c.fontSize <= medFont * 1.8 && !c.text.includes('\n') && c.height <= (c.fontSize || 10) * 2.6);

  const tables: DetectedTable[] = [];
  const used = new Set<string>();
  // low-confidence candidates NOT emitted (degraded to text) — the AI table-rescue path may
  // recover their LOGICAL structure and re-anchor it to these cells' measured boxes.
  const rejected: DetectedTable[] = [];

  // STRATEGY A (playbook T2, pdfplumber "lines"): when the source drew RULING LINES, snap/join
  // them, intersect, and read the smallest-cell grid — exact rows × cols straight from the ink.
  if (edges && edges.length >= 4) {
    for (const gt of detectGridTables(edges)) {
      const t = gridToDetected(gt, flat);
      if (t && t.confidence >= CONFIDENCE_MIN) {
        tables.push(t);
        for (const id of t.consumedIds) used.add(id);
      } else if (t) rejected.push(t);
    }
    flat = flat.filter((c) => !used.has(c.id));
  }

  // STRATEGY B (borderless): our RTL-tuned column-anchor method (a pdfplumber "text"-strategy
  // variant that keeps two INTERLEAVED side-by-side tables separate — see toColumns/groupTables).
  let cols = toColumns(flat, pageWidth);
  // drop sparse OUTLIER columns (a real grid column has many stacked cells; scattered numbers like a
  // car's dimension callouts form 1-2-cell "columns" that would bloat a table's bbox over the image).
  cols = cols.filter((c) => c.cells.length >= 3);
  const groups = groupTables(cols);
  for (const g of groups) {
    const t = buildTable(g);
    if (!t) continue;
    // a real table has multiple rows AND (multiple columns OR a long single-column list).
    // A single-column group must also be vertically DENSE (rows stacked like a list) — a sparse
    // column of rowspan CATEGORY labels ("מנוע בנזין" beside a spec grid) is not its own table;
    // its cells stay free text at their original positions.
    const denseRows = t.rowHeight <= Math.max(10, t.fontSize * 3);
    // F4: emit only a table whose grid is regular enough (confidence ≥ threshold); a low score means
    // the cells don't form a real grid → leave them as free text rather than an inconsistent table.
    if (t.rows.length >= 3 && t.confidence >= CONFIDENCE_MIN && (t.columns >= 2 || (t.rows.length >= 6 && denseRows))) {
      tables.push(t);
      for (const id of t.consumedIds) used.add(id); // only cells in KEPT rows (trimmed strays stay text)
    } else if (t.rows.length >= 3 && t.confidence < CONFIDENCE_MIN) rejected.push(t);
  }
  return { tables, used, rejected };
}

/** Convert a Strategy-A grid into our RTL-logical DetectedTable (grid columns are left→right;
 * logical order puts the LABEL column — the rightmost — at index 0). Rejects degenerate grids
 * (needs ≥3 rows × ≥2 cols with ≥40% of cells carrying text). */
function gridToDetected(gt: GridTable, cells: TextBlockIR[]): DetectedTable | null {
  const nRows = gt.rows.length - 1, nCols = gt.cols.length - 1;
  if (nRows < 3 || nCols < 2) return null;
  const words = cells.map((c) => ({ text: c.text, x0: c.x, x1: c.x + c.width, top: c.y, bottom: c.y + c.height, size: c.fontSize || 10 }));
  const grid = gridCellText(gt, words, true);
  const filled = grid.flat().filter((t) => t.trim()).length;
  if (filled < nRows * nCols * 0.4 || filled < 6) return null;
  const inside = cells.filter((c) => {
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
    return cx >= gt.x0 && cx <= gt.x1 && cy >= gt.top && cy <= gt.bottom;
  });
  if (!inside.length) return null;
  const fsz = inside.map((c) => c.fontSize).sort((a, b) => a - b);
  const fontSize = fsz[Math.floor(fsz.length / 2)] || 10;
  // logical order = grid columns REVERSED (label on the right)
  const allRows: TableRowIR[] = grid.map((gr) => {
    const logical = [...gr].reverse();
    const label = logical[0], values = logical.slice(1);
    if (label && !values.some((v) => v)) return { kind: 'section', cells: [label] } as TableRowIR;
    if (!label && values.some((v) => v)) return { kind: 'header', cells: logical } as TableRowIR;
    return { kind: 'data', cells: logical } as TableRowIR;
  });
  // F4: same stray-section trim as the borderless path (footnote/prose/trailing header → not a row)
  const rows = allRows.filter((r, i) => {
    if (r.kind !== 'section') return true;
    const followedByData = allRows.slice(i + 1).some((n) => n.kind === 'data');
    return !isStraySection(r.cells[0] || '', followedByData);
  });
  if (rows.length < 3) return null;
  const totalW = gt.x1 - gt.x0 || 1;
  const widths: number[] = [];
  for (let i = nCols - 1; i >= 0; i--) widths.push((gt.cols[i + 1] - gt.cols[i]) / totalW);
  let vals = 0, digits = 0, coherent = 0;
  for (const r of rows) {
    if (r.kind === 'data') {
      const rv = r.cells.slice(1).filter((c) => c.trim());
      if (r.cells[0]?.trim() && rv.length) coherent++;
      for (const c of rv) { vals++; if (/\d/.test(c) && c.replace(/[\d.,/%+\-\s()x×]/gi, '').length <= 2) digits++; }
    } else coherent++;
  }
  return {
    bbox: { x: gt.x0, y: gt.top, width: gt.x1 - gt.x0, height: gt.bottom - gt.top },
    columns: nCols, colFractions: widths, rows,
    rowHeight: (gt.bottom - gt.top) / nRows, fontSize,
    numeric: digits >= Math.max(3, vals * 0.3),
    color: mode(inside.map((c) => c.color)),
    fontFamily: mode(inside.map((c) => c.fontFamily)),
    confidence: coherent / rows.length,
    consumedIds: inside.map((c) => c.id),
  };
}

/** Build Strategy-A edges from a page's extracted RULING-LINE shapes (thin rects). */
export function pageEdges(page: PageIR): Edge[] {
  const edges: Edge[] = [];
  for (const b of page.blocks) {
    if (b.type !== 'shape' && b.type !== 'background') continue;
    const s = b as ShapeBlockIR;
    if (Math.min(s.width, s.height) > 3 || Math.max(s.width, s.height) < 8) continue;
    if (s.height >= s.width) edges.push({ orientation: 'v', x0: s.x + s.width / 2, x1: s.x + s.width / 2, top: s.y, bottom: s.y + s.height });
    else edges.push({ orientation: 'h', x0: s.x, x1: s.x + s.width, top: s.y + s.height / 2, bottom: s.y + s.height / 2 });
  }
  return edges;
}

const UNITS = /כ["׳]?ס|סמ["׳]?ק|ק["׳]?ג|ק["׳]?מ|קמ["׳]?ש|מ["׳]?מ|קוט["׳]?ש|נ["׳]?מ|\bhp\b|\bkW\b|\bNm\b/i;

/** Is this page a genuine DATA-TABLE page (spec/equipment grid)? Structural signals only —
 * shared by learning (row grouping) and edit-path reconstruction, so a marketing/prose page can
 * never be "tabled". */
export function isTablePage(page: PageIR): boolean {
  const texts = page.blocks.filter((b): b is TextBlockIR => b.type === 'text');
  if (texts.length < 26) return false;
  // timeline/heritage narrative (years, no measurement units) is prose, not a grid
  const allText = texts.map((t) => t.text).join(' ');
  const years = (allText.match(/\b(19|20)\d{2}\b/g) || []).length;
  const units = (allText.match(UNITS) || []).length;
  if (years >= 4 && units <= 1) return false;
  // PRIMARY table signal, checked FIRST: a GRID OF SHORT CELLS — wins even with a big dimension
  // diagram or no big heading (a headingless spec page breaks the relative-font test below).
  const shortCells = texts.filter((t) => t.text.trim().split(/\s+/).length <= 4).length;
  if (shortCells >= texts.length * 0.6) return true;
  // "small" is RELATIVE to the page's own heading size, not an absolute point size.
  const maxFont = Math.max(0, ...texts.map((t) => t.fontSize));
  const smallThresh = Math.max(11, maxFont * 0.45);
  const small = texts.filter((t) => t.fontSize < smallThresh).length;
  if (small / texts.length < 0.55) return false;
  // A hero spread — ONE big image, OR SEVERAL medium images covering a quarter+ of the page — plus
  // a heading is a MARKETING page, not a data table (even when the copy mentions systems/units).
  const pageArea = page.width * page.height;
  const imgs = page.blocks.filter((b) => b.type === 'image');
  const bigImage = imgs.some((im) => im.width * im.height >= pageArea * 0.22);
  const totalImg = imgs.reduce((s, im) => s + im.width * im.height, 0);
  const bigHeading = texts.some((t) => t.fontSize >= 18);
  if ((bigImage || totalImg >= pageArea * 0.25) && bigHeading) return false;
  // Narrative/marketing prose: many long sentences (≥8 words) rather than short table cells.
  const prose = texts.filter((t) => t.text.trim().split(/\s+/).length >= 8).length;
  if (prose >= 4 && prose >= texts.length * 0.22) return false;
  return true;
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
  if (!isTablePage(page)) return; // NEVER "table" a marketing/prose page (paragraphs are units)
  const texts = page.blocks.filter((b): b is TextBlockIR => b.type === 'text');
  const { tables, used } = detectTables(texts, page.width, pageEdges(page));
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
