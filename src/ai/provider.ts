// Semantic-provider interface (part of THE CONTRACT). Gemini is the first implementation;
// a Claude API provider can be swapped in behind this exact interface. Providers receive a
// page RENDER + the extractor's block list and return LABELS ONLY (validated against
// semanticSchema) — never coordinates, never new blocks, never rewritten text.
import type { PageSemantics, TableRescue } from './semanticSchema';

/** Compact block descriptor sent to the model (id + measured facts; text truncated to 80). */
export interface CompactBlock {
  id: string;
  kind: 'text' | 'image' | 'table' | 'shape';
  /** [x, y, w, h] in PDF points, rounded — context for the model, never echoed back. */
  bbox: [number, number, number, number];
  text?: string; // <=80 chars
  fontSize?: number;
  bold?: boolean;
}

/** A user-corrected page injected as a few-shot example (compact payload + approved labels). */
export interface FewShotExample {
  blocks: CompactBlock[];
  labels: PageSemantics;
}

export interface PageClassifyInput {
  /** Page render as JPEG, base64 (no data: prefix), longest edge <=1400px. */
  imageJpegBase64: string;
  blocks: CompactBlock[];
  /** Page size in points (context only). */
  pageWidth: number;
  pageHeight: number;
  brand?: string;
  /** The 2 most recently corrected pages for this brand. */
  fewShot?: FewShotExample[];
}

export interface TableRescueInput {
  /** Cropped table-region render as JPEG base64 (no data: prefix). */
  imageJpegBase64: string;
  /** The raw extracted text runs inside the region (context; the model returns LOGICAL structure only). */
  texts: string[];
}

export interface SemanticProvider {
  readonly name: string;
  /** Classify one page. Implementations MUST validate with the contract schema (temperature 0,
   * one retry on schema failure) and reject invented block ids. */
  classifyPage(input: PageClassifyInput): Promise<PageSemantics>;
  /** Recover a table's LOGICAL structure from a region image. Optional capability. */
  rescueTable?(input: TableRescueInput): Promise<TableRescue>;
}
