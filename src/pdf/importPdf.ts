// Stage 2 (C.4): turn an uploaded PDF (ArrayBuffer) into a DocumentIR using pdf.js.
// The imported IR — never IMPORT3008/IMPORTC3 — is the source of truth after upload.
import type { DocumentIR, PageIR, ImageBlockIR, ShapeBlockIR } from '../types/catalog';
import { extractTextBlocks } from './extractLayout';
import { renderPageCanvas, cropCanvasErasingText } from './renderPage';
import { walkPage, resolveImage, type ShapeOp } from './extractImages';

let workerConfigured = false;

// pdf.js entry differs between browser (worker) and Node (verification).
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !workerConfigured) {
    // Inline worker (base64 blob): works in dev, in a normal build, AND in a single-file
    // offline build — no separate worker URL to fetch.
    const Worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')).default;
    (pdfjs as any).GlobalWorkerOptions.workerPort = new Worker();
    workerConfigured = true;
  }
  return pdfjs as any;
}

export interface ImportOptions {
  renderPreviews?: boolean; // browser only
  previewScale?: number;
}

export async function importPdf(
  data: ArrayBuffer | Uint8Array,
  sourcePdfName: string,
  opts: ImportOptions = {},
): Promise<DocumentIR> {
  const pdfjs = await loadPdfjs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;

  const pages: PageIR[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const id = `p${n}`;
    const tc = await page.getTextContent();
    const textBlocks = extractTextBlocks(tc, vp.height, id);
    // text sits in paint order ABOVE images (captions over photos)
    textBlocks.forEach((b, i) => { b.zIndex = 1_000_000 + i; });

    // SINGLE op-list walk → images + filled shapes in paint order. Shapes need NO canvas,
    // so design panels/strips are captured even in a headless (renderPreviews:false) import.
    const { images: imageOps, shapes: shapeOps } = await walkPage(page, (pdfjs as any).OPS, vp.height);

    const shapeBlocks: ShapeBlockIR[] = dedupeShapes(shapeOps).map((s, i) => ({
      id: `${id}_sh${i}`, type: 'shape', x: s.bbox.x, y: s.bbox.y, width: s.bbox.width, height: s.bbox.height,
      rotation: 0, zIndex: s.opIndex, source: 'original',
      originalBBox: { x: s.bbox.x, y: s.bbox.y, width: s.bbox.width, height: s.bbox.height },
      fill: s.fill,
    }));

    let previewImage: string | undefined;
    const imageBlocks: ImageBlockIR[] = [];
    if (opts.renderPreviews && typeof window !== 'undefined') {
      const makeCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      try {
        const rendered = await renderPageCanvas(page, opts.previewScale ?? 2);
        previewImage = rendered.dataUrl;
        for (let i = 0; i < imageOps.length; i++) {
          const op = imageOps[i];
          let src = await resolveImage(page, op, makeCanvas);
          if (!src) {
            // last resort: crop preview but ERASE overlapping text so it can't carry text
            const overlap = textBlocks.filter((t) => !(t.x + t.width < op.bbox.x || t.x > op.bbox.x + op.bbox.width || t.y + t.height < op.bbox.y || t.y > op.bbox.y + op.bbox.height));
            src = cropCanvasErasingText(rendered.canvas, rendered.scale, op.bbox, overlap);
            console.warn(`[import] RENDER-CROP FALLBACK fired on ${id} image op#${op.opIndex} (${op.name || 'inline'}) — clean source unresolved; text erased. Resolution has a gap.`);
          }
          if (!src) continue;
          imageBlocks.push({
            id: `${id}_img${i}`, type: 'image', x: op.bbox.x, y: op.bbox.y, width: op.bbox.width, height: op.bbox.height,
            rotation: 0, zIndex: op.opIndex, source: 'original',
            originalBBox: { x: op.bbox.x, y: op.bbox.y, width: op.bbox.width, height: op.bbox.height },
            src, originalImageRef: src, fit: 'cover',
          });
        }
      } catch (e) { console.warn('[import] image pass failed', e); }
    }

    pages.push({
      id,
      width: Math.round(vp.width),
      height: Math.round(vp.height),
      rotation: vp.rotation || 0,
      originalPdfPageIndex: n - 1,
      previewImage,
      // paint order: shapes (under) → images → text (on top); each keeps its op-order zIndex
      blocks: [...shapeBlocks, ...imageBlocks, ...textBlocks],
    });
  }

  // (helper hoisted below)
  const n = sourcePdfName.toLowerCase();
  const brand = /peugeot|208|2008|3008|5008|rifter|boxer/.test(n) ? 'peugeot'
    : /citroen|citro|c3|c4|c5|berlingo|jumpy/.test(n) ? 'citroen' : 'unknown';

  return {
    id: `doc_${Date.now()}`,
    sourcePdfName,
    brand,
    pages,
  };
}

/** Merge near-duplicate filled rects (same fill + heavy overlap) and cap per-page count. */
function dedupeShapes(shapes: ShapeOp[]): ShapeOp[] {
  const out: ShapeOp[] = [];
  for (const s of shapes) {
    const dup = out.find((o) => o.fill === s.fill && iou(o.bbox, s.bbox) > 0.85);
    if (dup) { if (area(s.bbox) > area(dup.bbox)) Object.assign(dup, s); continue; }
    out.push({ ...s });
  }
  // largest first; keep the most prominent panels
  return out.sort((a, b) => area(b.bbox) - area(a.bbox)).slice(0, 80);
}
function area(b: { width: number; height: number }): number { return b.width * b.height; }
function iou(a: ShapeOp['bbox'], b: ShapeOp['bbox']): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = area(a) + area(b) - inter;
  return uni <= 0 ? 0 : inter / uni;
}
