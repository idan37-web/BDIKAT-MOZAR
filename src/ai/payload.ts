// Builds the classifier's inputs from the IR (iron rule: geometry MEASURES — every fact here
// comes from the extractor; the model only attaches labels to these ids).
import type { PageIR, TextBlockIR, TableBlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock, isTableBlock } from '../types/catalog';
import type { CompactBlock } from './provider';

const SNIPPET = 80;

/** Compact block list for one page: [{id, kind, bbox rounded, text<=80, fontSize, bold}].
 * Thin gridline shapes are skipped (hundreds per spec page — pure noise for classification). */
export function buildCompactBlocks(page: PageIR, maxBlocks = 80): CompactBlock[] {
  const out: CompactBlock[] = [];
  for (const b of page.blocks) {
    if (b.deleted) continue;
    const bbox: [number, number, number, number] = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    if (isTextBlock(b)) {
      const t = b as TextBlockIR;
      out.push({
        id: b.id, kind: 'text', bbox,
        text: t.text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET),
        fontSize: Math.round(t.fontSize * 10) / 10,
        bold: (t.fontWeight || 400) >= 600 || undefined,
      });
    } else if (isTableBlock(b)) {
      const t = b as TableBlockIR;
      const sample = t.rows.slice(0, 2).map((r) => r.cells.filter(Boolean).join(' | ')).join(' ');
      out.push({ id: b.id, kind: 'table', bbox, text: `${t.rows.length}x${t.columns}: ${sample}`.slice(0, SNIPPET), fontSize: t.fontSize });
    } else if (isImageBlock(b)) {
      out.push({ id: b.id, kind: 'image', bbox });
    } else if (isShapeBlock(b)) {
      // panels only; gridlines/rules are design noise
      if (Math.min(b.width, b.height) <= 3) continue;
      out.push({ id: b.id, kind: 'shape', bbox });
    }
  }
  // largest-first keeps the semantically heavy blocks when a dense page exceeds the budget
  return out.length <= maxBlocks ? out : [...out].sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]).slice(0, maxBlocks);
}

async function loadImg(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('page render failed to load'));
    el.src = dataUrl;
  });
}

/** Downscale a rendered page (data URL) to a JPEG whose longest edge <=1400px; returns raw
 * base64 (no data: prefix). Browser-only (canvas); Node callers produce their own JPEG. */
export async function toClassifierJpeg(dataUrl: string, maxEdge = 1400, quality = 0.8): Promise<string> {
  const img = await loadImg(dataUrl);
  const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality).split(',')[1];
}

/** Crop a page-region (bbox in PDF points) out of the page render, as JPEG base64 —
 * the table-rescue input. Browser-only. */
export async function cropRegionJpeg(
  dataUrl: string, pageWidthPt: number, bbox: { x: number; y: number; width: number; height: number },
  maxEdge = 1400, quality = 0.85, padPt = 4,
): Promise<string> {
  const img = await loadImg(dataUrl);
  const k = img.naturalWidth / pageWidthPt; // render px per pt
  const sx = Math.max(0, (bbox.x - padPt) * k);
  const sy = Math.max(0, (bbox.y - padPt) * k);
  const sw = Math.min(img.naturalWidth - sx, (bbox.width + padPt * 2) * k);
  const sh = Math.min(img.naturalHeight - sy, (bbox.height + padPt * 2) * k);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality).split(',')[1];
}
