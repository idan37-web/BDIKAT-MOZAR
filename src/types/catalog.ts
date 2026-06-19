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
export type ImageFit = 'cover' | 'contain';

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
  /** Crop as fractions of the source (0..1). */
  crop?: { fx: number; fy: number; fw: number; fh: number };
  /** Bounded-fallback only: solid cover color sampled from the page background. */
  mask?: string;
}

export interface ShapeBlockIR extends BlockIR {
  type: 'shape' | 'background';
  /** Fill colour "#rrggbb" (sampled from the source fill op). */
  fill?: string;
  stroke?: { color: string; width: number };
  /** Corner radius in points. */
  radius?: number;
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
