// Milestone D — lay a structured SpecSheet out as real IR blocks inside a page region.
// We deliberately FLATTEN to existing block types (text cells + thin shape gridlines) so the
// hard-won RTL vector export and the editor render the table with ZERO new code paths. The
// table is still data-driven: rows come from the sheet, so adding/removing a row = edit the
// sheet and regenerate. Layout is RTL: the label column sits on the RIGHT, value columns to its left.
import type { BBox, BlockIR, ShapeBlockIR, TextBlockIR, TableBlockIR, TableRowIR, TextAlign } from '../types/catalog';
import type { SpecSheet, FeatureCategory } from './specModel';
import { wrapText, type Measure } from '../catalog/autofit';

export interface LayoutStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  headingColor?: string;
  gridColor?: string;
  lineHeight?: number;
}

let SEQ = 0;
const uid = (p: string) => `${p}_${(SEQ++).toString(36)}`;

function textCell(
  text: string, bbox: BBox, st: LayoutStyle, z: number,
  opts: { bold?: boolean; align?: TextAlign; color?: string; size?: number } = {},
): TextBlockIR {
  const size = opts.size ?? st.fontSize;
  return {
    id: uid('cell'), type: 'text',
    x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height,
    rotation: 0, zIndex: z, source: 'generated', originalBBox: { ...bbox },
    text, originalText: text,
    fontFamily: st.fontFamily, fontSize: size,
    fontWeight: opts.bold ? 700 : 400, lineHeight: st.lineHeight || 1.15,
    color: opts.color || st.color, direction: 'rtl', align: opts.align || 'end',
  };
}

function rule(bbox: BBox, st: LayoutStyle, z: number): ShapeBlockIR {
  return {
    id: uid('rule'), type: 'shape',
    x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height,
    rotation: 0, zIndex: z, source: 'generated', originalBBox: { ...bbox },
    fill: st.gridColor || '#d7dade',
  };
}

export interface TableLayout {
  blocks: BlockIR[];
  /** bottom Y reached (points) — lets callers stack features/colours under the table. */
  bottom: number;
  /** rows that did not fit in the region (flagged, never silently clipped). */
  overflowRows: number;
  usedFontSize: number;
}

export interface SpecTableOptions {
  title?: string;
  /** measure for auto-fit (font.widthOfTextAtSize in the gate; canvas in the browser). */
  measure?: Measure;
  minScale?: number;
}

/**
 * Lay the spec sections out as a gridded table inside `region`. Header row = trim names;
 * each section emits a full-width title row then its data rows (label on the right, one
 * value column per trim to the left). Font auto-shrinks to a floor to fit the region height.
 */
export function layoutSpecTable(
  sheet: SpecSheet, region: BBox, st: LayoutStyle, opts: SpecTableOptions = {},
): TableLayout {
  const measure = opts.measure || ((t, s) => t.length * s * 0.5);
  const minScale = opts.minScale ?? 0.75;
  const nTrims = Math.max(1, sheet.trims.length);

  // Flatten sections into a sequence of "units" (a section title, then its rows) that flow
  // across columns. Each column repeats the trim header at its top.
  type Unit = { kind: 'section'; title: string } | { kind: 'row'; label: string; values: string[] };
  const units: Unit[] = [];
  for (const sec of sheet.sections) {
    units.push({ kind: 'section', title: sec.title });
    for (const r of sec.rows) units.push({ kind: 'row', label: r.unit ? `${r.label} (${r.unit})` : r.label, values: r.values });
  }

  const baseSize = st.fontSize;
  const floor = Math.max(5, baseSize * minScale);
  const lh = st.lineHeight || 1.2;
  const prefRh = Math.max(baseSize * lh * 1.3, baseSize + 4);
  const minRh = Math.max(8, floor + 1);

  // Multi-column flow: use the spread width (the brochures put 2 columns side-by-side). Each
  // column carries a header row, so usable rows per column = capacity - 1.
  const minColW = 240;
  const maxCols = Math.max(1, Math.floor(region.width / minColW));
  const titleH = opts.title ? prefRh : 0;
  const availH = region.height - titleH;
  const capAt = (rh: number) => Math.max(2, Math.floor(availH / rh)); // includes the header row
  let cols = Math.min(maxCols, Math.max(1, Math.ceil(units.length / (capAt(prefRh) - 1))));
  let rh = prefRh;
  // if it still doesn't fit at the preferred row height, shrink rh toward the floor
  if (cols * (capAt(rh) - 1) < units.length) {
    const perCol = Math.ceil(units.length / cols) + 1; // +1 header
    rh = Math.max(minRh, availH / perCol);
  }
  const size = Math.min(baseSize, Math.max(floor, rh / 1.35));
  const usablePerCol = Math.max(1, Math.floor(availH / rh) - 1);
  const colW = region.width / cols;
  const colX = (c: number) => region.x + (cols - 1 - c) * colW; // RTL: column 0 is the rightmost

  const blocks: BlockIR[] = [];
  const z0 = 100;
  let overflow = 0;

  if (opts.title) {
    blocks.push(textCell(opts.title, { x: region.x, y: region.y, width: region.width, height: prefRh }, st, z0 + 5,
      { bold: true, size: size + 2, color: st.headingColor || st.color }));
  }

  // per-column geometry (label on the right of the column, value columns to its left)
  const labelW = Math.min(colW * 0.55, Math.max(colW * 0.42, 80));
  const valArea = colW - labelW;
  const valW = valArea / nTrims;
  const colTop = region.y + titleH;

  const drawHeader = (c: number) => {
    const cx = colX(c);
    const labelX = cx + valArea;
    for (let t = 0; t < nTrims; t++) {
      const vx = labelX - (t + 1) * valW;
      blocks.push(textCell(sheet.trims[t] || '', { x: vx, y: colTop, width: valW, height: rh }, st, z0 + 6,
        { bold: true, align: 'center', color: st.headingColor || st.color }));
    }
    blocks.push(rule({ x: cx, y: colTop + rh - 1, width: colW - 6, height: 1 }, st, z0 + 1));
  };

  let placed = 0;
  for (let c = 0; c < cols && placed < units.length; c++) {
    const cx = colX(c);
    const labelX = cx + valArea;
    const valX = (t: number) => labelX - (t + 1) * valW;
    drawHeader(c);
    let y = colTop + rh;
    let inCol = 0;
    while (placed < units.length && inCol < usablePerCol) {
      const u = units[placed];
      if (u.kind === 'section') {
        blocks.push(textCell(u.title, { x: cx, y, width: colW - 6, height: rh }, st, z0 + 4,
          { bold: true, color: st.headingColor || st.color }));
        blocks.push(rule({ x: cx, y: y + rh - 0.6, width: colW - 6, height: 0.6 }, st, z0 + 1));
      } else {
        const labelLines = wrapText(u.label, labelW - 6, size, measure);
        blocks.push(textCell(labelLines.join(' '), { x: labelX + 3, y, width: labelW - 6, height: rh }, st, z0 + 3, { align: 'end' }));
        for (let t = 0; t < nTrims; t++) {
          blocks.push(textCell(u.values[t] ?? '', { x: valX(t) + 2, y, width: valW - 4, height: rh }, st, z0 + 3, { align: 'center' }));
        }
        blocks.push(rule({ x: cx, y: y + rh - 0.4, width: colW - 6, height: 0.4 }, st, z0));
      }
      y += rh;
      placed++;
      inCol++;
    }
    // vertical separators for this column (between value cols + label edge)
    const colBottom = y;
    for (let t = 0; t <= nTrims; t++) {
      blocks.push(rule({ x: labelX - t * valW, y: colTop, width: 0.4, height: colBottom - colTop }, st, z0));
    }
  }
  overflow = Math.max(0, units.length - placed);

  return { blocks, bottom: colTop + (usablePerCol + 1) * rh, overflowRows: overflow, usedFontSize: size };
}

/** Keep a table's box height in sync with its rows (called after add/remove row). */
export function syncTableHeight(t: TableBlockIR): void {
  t.height = t.rows.length * t.rowHeight;
}

/**
 * Build a first-class, editable spec table (single rectangular grid) from the sheet:
 * a header row (trim names), then per section a full-width title row + its data rows.
 * Columns (logical order): 0 = label, 1..n = trims. Row height fits the region.
 */
export function buildSpecTable(sheet: SpecSheet, region: BBox, st: LayoutStyle): TableBlockIR {
  const nTrims = Math.max(1, sheet.trims.length);
  const columns = 1 + nTrims;
  const rows: TableRowIR[] = [];
  rows.push({ kind: 'header', cells: ['', ...sheet.trims] });
  for (const sec of sheet.sections) {
    rows.push({ kind: 'section', cells: [sec.title] });
    for (const r of sec.rows) {
      const label = r.unit ? `${r.label} (${r.unit})` : r.label;
      rows.push({ kind: 'data', cells: [label, ...r.values.slice(0, nTrims)] });
    }
  }

  const base = st.fontSize;
  const lh = st.lineHeight || 1.2;
  const prefRh = Math.max(base * lh * 1.4, base + 5);
  const minRh = Math.max(9, base * 0.7 + 1);
  const rowHeight = Math.max(minRh, Math.min(prefRh, region.height / Math.max(1, rows.length)));

  // a moderate width (label + trim columns) right-aligned in the region; the user can widen/move it
  const width = Math.min(region.width, 230 + nTrims * 130);
  const x = region.x + region.width - width; // RTL: hug the right edge
  const labelFrac = nTrims >= 2 ? 0.46 : 0.62;
  const trimFrac = (1 - labelFrac) / nTrims;
  const colFractions = [labelFrac, ...new Array(nTrims).fill(trimFrac)];

  return {
    id: uid('table'), type: 'table',
    x, y: region.y, width, height: rows.length * rowHeight,
    rotation: 0, zIndex: 200, source: 'generated',
    originalBBox: { x, y: region.y, width, height: rows.length * rowHeight },
    columns, colFractions, rows, rowHeight,
    fontFamily: st.fontFamily, fontSize: Math.min(base, rowHeight / 1.5),
    color: st.color, headingColor: st.headingColor || st.color, gridColor: st.gridColor || '#d7dade',
    direction: 'rtl',
  };
}

/** Lay out the equipment/feature categories as titled lists with a ✓ per trim. */
export function layoutFeatures(
  features: FeatureCategory[], trims: string[], region: BBox, st: LayoutStyle, opts: { measure?: Measure } = {},
): TableLayout {
  const measure = opts.measure || ((t, s) => t.length * s * 0.5);
  const nTrims = Math.max(1, trims.length);
  const size = st.fontSize;
  const lh = st.lineHeight || 1.2;
  const rh = Math.max(size * lh * 1.25, size + 3);
  const checkW = nTrims > 1 ? Math.min(region.width * 0.3, nTrims * 26) : 16;
  const labelX = region.x + checkW;
  const labelW = region.width - checkW;
  const blocks: BlockIR[] = [];
  let y = region.y;
  let overflow = 0;
  const z0 = 120;
  for (const cat of features) {
    if (y + rh > region.y + region.height + 0.6) { overflow += cat.items.length + 1; continue; }
    blocks.push(textCell(cat.title, { x: region.x, y, width: region.width, height: rh }, st, z0 + 2,
      { bold: true, color: st.headingColor || st.color }));
    y += rh;
    for (const it of cat.items) {
      if (y + rh > region.y + region.height + 0.6) { overflow++; continue; }
      const lines = wrapText(it.label, labelW - 4, size, measure);
      const cellH = Math.max(rh, lines.length * size * lh);
      blocks.push(textCell(lines.join(' '), { x: labelX, y, width: labelW - 4, height: cellH }, st, z0 + 1, { align: 'end' }));
      for (let t = 0; t < nTrims; t++) {
        const mark = it.perTrim[t] ? '✓' : '–';
        const cx = region.x + (nTrims > 1 ? t * (checkW / nTrims) : 0);
        blocks.push(textCell(mark, { x: cx, y, width: checkW / nTrims, height: cellH }, st, z0 + 1, { align: 'center' }));
      }
      y += cellH;
    }
  }
  return { blocks, bottom: y, overflowRows: overflow, usedFontSize: size };
}

/** Lay out the colour list (name + swatch + type) and wheels under it. */
export function layoutColors(sheet: SpecSheet, region: BBox, st: LayoutStyle): TableLayout {
  const size = st.fontSize;
  const lh = st.lineHeight || 1.2;
  const rh = Math.max(size * lh * 1.3, size + 6);
  const blocks: BlockIR[] = [];
  let y = region.y;
  let overflow = 0;
  const z0 = 130;
  const sw = size * 1.1; // swatch square
  for (const c of sheet.colors) {
    if (y + rh > region.y + region.height + 0.6) { overflow++; continue; }
    // swatch on the right edge, name to its left (RTL)
    const swX = region.x + region.width - sw;
    if (c.code) {
      blocks.push({
        id: uid('sw'), type: 'shape', x: swX, y: y + (rh - sw) / 2, width: sw, height: sw,
        rotation: 0, zIndex: z0 + 2, source: 'generated', originalBBox: { x: swX, y, width: sw, height: sw },
        fill: c.code, stroke: { color: '#999999', width: 0.5 },
      } as ShapeBlockIR);
    }
    const typeLabel = c.type === 'metallic' ? 'מטאלי' : c.type === 'pearl' ? 'פנינה' : 'רגיל';
    blocks.push(textCell(`${c.name} · ${typeLabel}`, { x: region.x, y, width: region.width - sw - 6, height: rh }, st, z0 + 1, { align: 'end' }));
    y += rh;
  }
  if (sheet.wheels.length) {
    y += rh * 0.3;
    blocks.push(textCell('חישוקים', { x: region.x, y, width: region.width, height: rh }, st, z0 + 1,
      { bold: true, color: st.headingColor || st.color }));
    y += rh;
    for (const w of sheet.wheels) {
      if (y + rh > region.y + region.height + 0.6) { overflow++; continue; }
      const t = w.size ? `${w.label} — ${w.size}` : w.label;
      blocks.push(textCell(t, { x: region.x, y, width: region.width, height: rh }, st, z0 + 1, { align: 'end' }));
      y += rh;
    }
  }
  return { blocks, bottom: y, overflowRows: overflow, usedFontSize: size };
}
