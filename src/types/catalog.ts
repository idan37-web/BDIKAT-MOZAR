// AutoSpec Studio — internal representation (IR).
// Per docs/AutoSpec-directive.md §C.1. The IR is the SOURCE OF TRUTH for editing/export.
// All coordinates are stored in PDF POINTS. Scaling happens at render time only.

export type BlockType =
  | 'text'
  | 'image'
  | 'shape'
  | 'table'
  | 'logo'
  | 'slot'
  | 'background';

export type BlockSource = 'original' | 'generated' | 'user';
export type TextDirection = 'rtl' | 'ltr' | 'mixed';
export type TextAlign = 'start' | 'center' | 'end' | 'justify';
export type ImageFit = 'cover' | 'contain' | 'fill';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockIR {
  id: string;
  type: BlockType;
  /** PDF points, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  source: BlockSource;
  locked?: boolean;
  /** Original geometry as extracted — for Compare/diff and revert. */
  originalBBox?: BBox;
  /** Edited since import (drives Compare/diff + export fallback decisions). */
  dirty?: boolean;
  /** Soft-deleted by the user (export draws a delete/mask rect in the fallback path). */
  deleted?: boolean;
}

/** Reference to a font usable both for DOM rendering and pdf-lib embedding. */
export interface EmbeddedFontRef {
  /** Key into the document font registry (also the embedded subset key on export). */
  id: string;
  /** Source file/url of the OTF/TTF to embed. */
  file: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface TextBlockIR extends BlockIR {
  type: 'text';
  /** LOGICAL order (never store visual/reversed order). */
  text: string;
  /** As-extracted text, for "modified" detection and revert. */
  originalText: string;
  fontFamily: string;
  /** Explicit font for embedding; NEVER inherit for imported text. */
  embeddedFontRef?: EmbeddedFontRef;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
  color: string; // "#rrggbb"
  direction: TextDirection;
  align: TextAlign;
  /** Optional pre-split logical lines (one physical line each). */
  lines?: string[];
}

export interface ImageBlockIR extends BlockIR {
  type: 'image';
  src: string;
  /** Pointer back to the original embedded image (for re-use at full quality). */
  originalImageRef?: string;
  fit: ImageFit;
  /** mirror horizontally (rotation lives on BlockIR.rotation, in degrees). */
  flipH?: boolean;
  /** Crop as fractions of the source (0..1). */
  crop?: { fx: number; fy: number; fw: number; fh: number };
  /** Bounded-fallback only: solid cover color sampled from the page background. */
  mask?: string;
  /** Optional outline/frame around the image box (points). Rendered in editor + export. */
  stroke?: { color: string; width: number };
  /** Outline corner radius in points. */
  radius?: number;
  /** Opacity 0..1 (1 = opaque). */
  opacity?: number;
  /** Non-destructive per-edge darkening 0..1 (0=none, 1=black at that edge → transparent inward). */
  edgeShade?: { top: number; right: number; bottom: number; left: number };
}

export interface ShapeBlockIR extends BlockIR {
  type: 'shape' | 'background';
  /** Fill colour "#rrggbb" (sampled from the source fill op). */
  fill?: string;
  stroke?: { color: string; width: number };
  /** Corner radius in points. */
  radius?: number;
  /** Constant fill alpha 0..1 (from the source graphics state) — e.g. a heading scrim. */
  opacity?: number;
}

/** Vertical placement of cell text within its row box (F5). */
export type CellVAlign = 'top' | 'middle' | 'bottom';

/** One row of a TableBlockIR. `data`/`header` rows carry one cell per column (logical order:
 * index 0 = label column); a `section` row is a single full-width title that spans all columns. */
export interface TableRowIR {
  kind: 'header' | 'section' | 'data';
  cells: string[];
  /** F5: per-row vertical alignment override (wins over the table default). */
  vAlign?: CellVAlign;
}

/** A first-class, editable spec table (Milestone D). Columns are in LOGICAL order
 * (index 0 = label); RTL rendering places column 0 on the RIGHT. It flattens to vector
 * text + gridlines on export, but stays a structured object so cells/rows are editable. */
export interface TableBlockIR extends BlockIR {
  type: 'table';
  /** total columns including the label column. */
  columns: number;
  /** width of each column as a fraction of the block width, LOGICAL order (sums ~1). */
  colFractions: number[];
  rows: TableRowIR[];
  /** points; block height is kept == rows.length * rowHeight. */
  rowHeight: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  headingColor?: string;
  gridColor?: string;
  /** optional fill behind ALL data cells (e.g. "#ffffff" to force a clean background). */
  cellBg?: string;
  /** optional fill behind SECTION-header rows (a captured highlight band, e.g. "#fff200"). */
  sectionBg?: string;
  /** F5: default vertical alignment of cell text for the whole table (per-row `vAlign` overrides). */
  vAlign?: CellVAlign;
  direction: TextDirection;
  embeddedFontRef?: EmbeddedFontRef;
}

export interface PageIR {
  id: string;
  /** PDF points. */
  width: number;
  height: number;
  rotation: number;
  /** Faithful page render — REFERENCE/COMPARE layer only, never edited on top of. */
  previewImage?: string;
  originalPdfPageIndex?: number;
  blocks: BlockIR[];
}

export interface DocumentIR {
  id: string;
  sourcePdfName?: string;
  brand?: string;          // detected from the source (drives the brand font)
  pages: PageIR[];
}

/** Narrowing helpers. */
export const isTextBlock = (b: BlockIR): b is TextBlockIR => b.type === 'text';
export const isImageBlock = (b: BlockIR): b is ImageBlockIR => b.type === 'image';
export const isShapeBlock = (b: BlockIR): b is ShapeBlockIR => b.type === 'shape' || b.type === 'background';
export const isTableBlock = (b: BlockIR): b is TableBlockIR => b.type === 'table';

/** Left edge (fraction 0..1 from the block's left) of a column in RTL layout — column 0
 * (label) sits on the RIGHT. Shared by render + export so they never diverge. */
export function columnLeftFraction(colFractions: number[], i: number): number {
  let f = 1;
  for (let k = 0; k <= i; k++) f -= colFractions[k] || 0;
  return Math.max(0, f);
}

/** F5: resolve the effective vertical alignment of a row's cells — per-row override, else the
 * table default, else middle. Shared by editor render + PDF export so they never diverge. */
export function resolveVAlign(table: { vAlign?: CellVAlign }, row: { vAlign?: CellVAlign }): CellVAlign {
  return row.vAlign ?? table.vAlign ?? 'middle';
}

/** F5: CSS flexbox cross-axis value for a vertical alignment (editor render). */
export function vAlignToFlex(v: CellVAlign): 'flex-start' | 'center' | 'flex-end' {
  return v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center';
}

/** F5: distance (points, downward) from a row's TOP to the text BASELINE for the given alignment
 * (PDF export). Middle keeps the historic cap-centred offset so existing output is unchanged; top
 * seats the ascent just below the row top, bottom seats the descender just above the row bottom. */
export function cellBaselineOffset(v: CellVAlign, rowHeight: number, fontSize: number): number {
  const pad = Math.min(3, rowHeight * 0.12);
  if (v === 'top') return pad + fontSize * 0.72;
  if (v === 'bottom') return rowHeight - pad - fontSize * 0.28;
  return rowHeight / 2 + fontSize * 0.34;
}
