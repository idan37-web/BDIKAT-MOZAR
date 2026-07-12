// Orchestration of the semantic layer over a whole document: per-page classification with the
// (fileHash, pageIndex) cache and per-brand few-shot injection, plus the table-rescue pass.
// Template learning may require connectivity (this file); GENERATION AND EDITING STAY OFFLINE —
// nothing outside the learning flow imports this module.
import type { DocumentIR, TextBlockIR } from '../types/catalog';
import { isTextBlock } from '../types/catalog';
import type { SemanticProvider } from './provider';
import type { PageSemantics } from './semanticSchema';
import { buildCompactBlocks, toClassifierJpeg, cropRegionJpeg } from './payload';
import { getCachedSemantics, setCachedSemantics, type KV } from './semanticCache';
import { fewShotFor } from './corrections';
import { detectTables, pageEdges, isTablePage } from '../templates/tableDetect';
import { alignRescuedCells, rescuedToSlotTable, RESCUE_ALIGN_MIN } from './tableRescue';
import type { TemplateSpec } from '../templates/templateSpec';

export interface ClassifyDocOptions {
  kv?: KV;
  onProgress?: (done: number, total: number, note: string) => void;
  /** override for tests / Node callers that render their own JPEG. */
  pageJpeg?: (pageIndex: number) => Promise<string>;
  /** parallel in-flight classifier calls (default 4 — serial page-by-page was the "really slow"
   * complaint; higher risks free-tier 429 storms, the transport's backoff absorbs the rest). */
  concurrency?: number;
}

/** Classify every page of a document IN PARALLEL (bounded). Cached pages never re-bill; a failed
 * page yields null (that page keeps the heuristic path — graceful degradation, never a hard
 * failure). Result order always matches page order regardless of completion order. */
export async function classifyDocument(
  doc: DocumentIR, provider: SemanticProvider, opts: ClassifyDocOptions = {},
): Promise<(PageSemantics | null)[]> {
  const hash = doc.fileHash || doc.id;
  const total = doc.pages.length;
  const out: (PageSemantics | null)[] = new Array(total).fill(null);
  const fewShot = fewShotFor(doc.brand || 'unknown', opts.kv); // hoisted: same for every page
  let done = 0;
  const queue = doc.pages.map((_, pi) => pi);

  const worker = async (): Promise<void> => {
    for (let pi = queue.shift(); pi !== undefined; pi = queue.shift()) {
      const page = doc.pages[pi];
      const cached = getCachedSemantics(hash, pi, opts.kv);
      if (cached) { out[pi] = cached; opts.onProgress?.(++done, total, 'cache'); continue; }
      try {
        const jpeg = opts.pageJpeg
          ? await opts.pageJpeg(pi)
          : page.previewImage ? await toClassifierJpeg(page.previewImage) : null;
        if (!jpeg) { opts.onProgress?.(++done, total, 'no render'); continue; }
        const sem = await provider.classifyPage({
          imageJpegBase64: jpeg,
          blocks: buildCompactBlocks(page),
          pageWidth: Math.round(page.width),
          pageHeight: Math.round(page.height),
          brand: doc.brand,
          fewShot,
        });
        setCachedSemantics(hash, pi, sem, opts.kv);
        out[pi] = sem;
        opts.onProgress?.(++done, total, provider.name);
      } catch (e) {
        opts.onProgress?.(++done, total, `error: ${(e as Error).message.slice(0, 80)}`);
      }
    }
  };
  const n = Math.max(1, Math.min(opts.concurrency ?? 4, total));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

export interface RescueReport { page: number; attempted: number; recovered: number; rates: number[] }

/**
 * Table rescue over a learned spec (contract §4): for every LOW-CONFIDENCE table candidate that
 * tableDetect degraded to text, ask the provider for LOGICAL structure, re-anchor cell texts to
 * the extractor's words, and — only at >=90% alignment — replace the degraded text slots with a
 * measured table slot. Mutates the spec. Returns a per-page report.
 */
export async function applyTableRescue(
  spec: TemplateSpec, doc: DocumentIR, provider: SemanticProvider,
): Promise<RescueReport[]> {
  if (!provider.rescueTable) return [];
  const reports: RescueReport[] = [];
  for (const pageSpec of spec.pages) {
    const page = doc.pages[pageSpec.index];
    if (!page || !page.previewImage || !isTablePage(page)) continue;
    const texts = page.blocks.filter(isTextBlock);
    const { rejected } = detectTables(texts, page.width, pageEdges(page));
    if (!rejected.length) continue;
    const report: RescueReport = { page: pageSpec.index, attempted: rejected.length, recovered: 0, rates: [] };
    for (const cand of rejected) {
      try {
        const regionWords: TextBlockIR[] = texts.filter((t) =>
          t.x + t.width > cand.bbox.x - 2 && t.x < cand.bbox.x + cand.bbox.width + 2 &&
          t.y + t.height > cand.bbox.y - 2 && t.y < cand.bbox.y + cand.bbox.height + 2);
        const jpeg = await cropRegionJpeg(page.previewImage, page.width, cand.bbox);
        const rescue = await provider.rescueTable({ imageJpegBase64: jpeg, texts: regionWords.map((w) => w.text) });
        const align = alignRescuedCells(rescue, regionWords);
        report.rates.push(Math.round(align.rate * 100) / 100);
        if (align.rate < RESCUE_ALIGN_MIN) continue; // keep the text-blocks degradation
        const table = rescuedToSlotTable(rescue, align, { fontSize: cand.fontSize, color: cand.color, fontFamily: cand.fontFamily });
        // replace text slots fully inside the recovered bbox with ONE measured table slot
        const inside = (b: { x: number; y: number; width: number; height: number }) =>
          b.x >= align.bbox.x - 3 && b.x + b.width <= align.bbox.x + align.bbox.width + 3 &&
          b.y >= align.bbox.y - 3 && b.y + b.height <= align.bbox.y + align.bbox.height + 3;
        pageSpec.slots = pageSpec.slots.filter((s) => !(s.blockType === 'text' && inside(s.bbox)));
        pageSpec.slots.push({
          id: `${page.id}_rescue${report.recovered}`,
          key: `p${pageSpec.index + 1}.spec_table.rescued${report.recovered}`,
          kind: 'spec-table', blockType: 'table', table,
          dynamic: true, bbox: align.bbox,
          label: 'טבלת מפרט (חולצה ב-AI)',
          sample: rescue.rows.slice(0, 2).map((r) => r.join(' | ')).join('\n'),
          confidence: Math.round(align.rate * 100) / 100,
          variants: 1, crossDocEvidence: false,
          semRole: 'spec_table', semConfidence: Math.round(align.rate * 100) / 100,
          semReason: `rescued: ${Math.round(align.rate * 100)}% of cells aligned to extracted words`,
        });
        pageSpec.slots.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
        report.recovered++;
      } catch { /* per-candidate failure keeps the degradation */ }
    }
    reports.push(report);
  }
  return reports;
}
