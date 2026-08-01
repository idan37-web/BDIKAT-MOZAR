// THE CONTRACT of the semantic layer (approved; changing enums/shape is a material change).
// Iron rule: the vision model CLASSIFIES, geometry MEASURES. The model only labels block IDs
// produced by our extractor — the schema has NO coordinate fields, NO text-rewrite fields, and
// validation REJECTS blocks whose ids were not in the request (no block creation).
import { z } from 'zod';

export const PAGE_TYPES = [
  'cover', 'model_overview', 'trim_equipment', 'tech_spec', 'safety', 'colors_wheels', 'legal', 'other',
] as const;
export type PageType = typeof PAGE_TYPES[number];

export const BLOCK_ROLES = [
  'brand_logo', 'model_name', 'trim_name', 'section_heading', 'hero_image', 'gallery_image',
  'spec_table', 'equipment_list', 'price', 'legal_text', 'footnote', 'page_number', 'decorative', 'other',
] as const;
export type BlockRole = typeof BLOCK_ROLES[number];

export const blockSemanticsSchema = z.object({
  id: z.string().min(1),
  role: z.enum(BLOCK_ROLES),
  variability: z.enum(['fixed', 'variable']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(120).transform((s) => s.split(/\s+/).slice(0, 15).join(' ')), // <=15 words
}).strict(); // no extra keys — a model emitting bbox/text fields FAILS validation

export const pageSemanticsSchema = z.object({
  pageType: z.enum(PAGE_TYPES),
  blocks: z.array(blockSemanticsSchema),
}).strict();

export type BlockSemantics = z.infer<typeof blockSemanticsSchema>;
export type PageSemantics = z.infer<typeof pageSemanticsSchema>;

// Table rescue (LOGICAL structure only): matrix of cell texts + header rows + colspans.
// Deliberately NO geometry — bboxes are recovered by aligning cell texts to extracted words.
export const tableRescueSchema = z.object({
  headerRows: z.array(z.number().int().min(0)),
  rows: z.array(z.array(z.string())),
  /** optional: [row, col, span] triples for section headers spanning multiple columns. */
  colspans: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(1)])).optional(),
}).strict();
export type TableRescue = z.infer<typeof tableRescueSchema>;

/** Tolerant envelope extraction (strip ``` fences / prose), then STRICT zod validation.
 * `allowedIds` enforces the iron rule: every returned block id must be one we sent. */
export function parsePageSemantics(text: string, allowedIds: Set<string>): PageSemantics {
  const parsed = pageSemanticsSchema.parse(extractJson(text));
  const unknown = parsed.blocks.filter((b) => !allowedIds.has(b.id));
  if (unknown.length) throw new Error(`model invented block ids: ${unknown.map((b) => b.id).slice(0, 5).join(', ')}`);
  // drop duplicates (keep the first occurrence of each id)
  const seen = new Set<string>();
  const blocks = parsed.blocks.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
  return { pageType: parsed.pageType, blocks };
}

export function parseTableRescue(text: string): TableRescue {
  return tableRescueSchema.parse(extractJson(text));
}

function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}
