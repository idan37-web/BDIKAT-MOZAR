// Stage 6 (C.8): the TemplateSpec — a learned, editable description of a brand
// catalog template. A template is a list of SLOTS + STYLE TOKENS over a fixed
// page skeleton, NEVER a picture of a page (per the brief: content · design ·
// data stay separated). It is derived from the IR and saved as plain JSON so the
// user can review/correct it, and Stage 7 (generation) can fill it.
import type { BBox, TextAlign, TextDirection } from '../types/catalog';

/** Repeated page roles across a same-family catalog. */
export type PageRole =
  | 'cover'
  | 'feature'   // marketing spread (hero image + heading + copy)
  | 'interior'  // interior / design spread
  | 'colors'    // colours + wheels selection
  | 'wheels'
  | 'safety'    // ADAS / safety systems
  | 'spec'      // technical spec table (dense small-font grid)
  | 'price'     // price / legal
  | 'back'      // legal / pollution / back cover
  | 'content';  // unclassified body page

/** What a slot produces when the template is filled. */
export type SlotKind =
  | 'model-name'
  | 'heading'
  | 'marketing-text'
  | 'hero-image'
  | 'image'
  | 'spec-table'
  | 'colors'
  | 'wheels'
  | 'safety'
  | 'pollution'
  | 'price'
  | 'legal'
  | 'logo'
  | 'background'
  | 'text';

export interface SlotStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  align?: TextAlign;
  direction?: TextDirection;
  lineHeight?: number;
}

export interface SlotSpec {
  id: string;
  /** Stable mapping key for Stage-7 asset binding (e.g. "p1.model-name"). */
  key: string;
  kind: SlotKind;
  /** Block type the slot generates. */
  blockType: 'text' | 'image' | 'shape';
  /** Shape slots only: fill colour "#rrggbb" (a per-model accent when dynamic). */
  fill?: string;
  /** true = filled per catalog (model name, hero, values); false = fixed brand element. */
  dynamic: boolean;
  /** PDF points, top-left origin. */
  bbox: BBox;
  style?: SlotStyle;
  /** Human-facing Hebrew label for the review UI. */
  label: string;
  /** Exemplar content carried from the learned page (text, or image ref). */
  sample?: string;
  /** For fixed slots: the literal content emitted at generation time. */
  fixedContent?: string;
  /** 0..1 — how strongly this slot was learned (cross-doc evidence raises it). */
  confidence: number;
  /** Distinct values seen for this slot across the learned documents. */
  variants: number;
  /** true if learning had real cross-document evidence (>=2 docs matched here). */
  crossDocEvidence: boolean;
  /** User marked this slot to be IGNORED — excluded from generation entirely. */
  ignored?: boolean;
}

/** Fixed design furniture (panels + gridlines) emitted wholesale at generation — NOT
 * reviewable slots (there are too many gridlines to review individually). */
export interface ShapeDesign {
  bbox: BBox;
  fill: string;
  /** thin stroked rule/gridline (vs a filled panel). */
  line?: boolean;
}

export interface TemplatePageSpec {
  index: number;
  role: PageRole;
  /** PDF points. */
  width: number;
  height: number;
  /** Why this role was chosen (transparency for the review UI). */
  roleEvidence: string[];
  slots: SlotSpec[];
  /** Fixed background design (panels + gridlines) reproduced at generation time. */
  design?: ShapeDesign[];
}

/** Brand-level style tokens. The accent colour is per-model → flagged dynamic. */
export interface TemplateTokens {
  text?: string;
  /** Candidate accent; `accentDynamic` true when it differed across learned docs. */
  accent?: string;
  accentDynamic?: boolean;
  fonts?: Record<string, string>;
}

export interface TemplateSpec {
  id: string;
  /** 'peugeot' | 'citroen' | … */
  brand: string;
  /** A same-brand template family is keyed by page format (print spread vs 16:9 deck). */
  family: string;
  format: 'print-spread' | 'square' | 'deck-16x9' | 'a4' | string;
  /** Source PDF filenames this template was learned from. */
  learnedFrom: string[];
  tokens: TemplateTokens;
  pages: TemplatePageSpec[];
  createdAt: string;
  version: number;
}

/** Detect the print/deck family from page geometry (drives template grouping). */
export function detectFormat(width: number, height: number): TemplateSpec['format'] {
  const ar = width / height;
  if (Math.abs(ar - 16 / 9) < 0.06) return 'deck-16x9';
  if (Math.abs(ar - 1) < 0.08) return 'square';
  if (ar > 1.7) return 'print-spread';
  if (Math.abs(ar - 1 / Math.SQRT2) < 0.06 || Math.abs(ar - Math.SQRT2) < 0.06) return 'a4';
  return `custom-${Math.round(ar * 100) / 100}`;
}
