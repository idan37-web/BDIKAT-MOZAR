// Stage 2 (C.4): turn an uploaded PDF (ArrayBuffer) into a DocumentIR using pdf.js.
// The imported IR — never IMPORT3008/IMPORTC3 — is the source of truth after upload.
import type { BBox, DocumentIR, PageIR, ImageBlockIR, ShapeBlockIR } from '../types/catalog';
import { extractTextBlocks } from './extractLayout';
import { renderPageCanvas, cropCanvasErasingText, cropGraphic, sampleInkColor } from './renderPage';
import { walkPage, resolveImage, type ShapeOp, type MakeCanvas } from './extractImages';

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
  /** Canvas factory for Node/headless image extraction (e.g. @napi-rs/canvas). When set,
   *  image objects are decoded without a DOM; the raster preview stays browser-only. */
  makeCanvas?: MakeCanvas;
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

    // SINGLE op-list walk → images + filled shapes in paint order. Shapes need NO canvas,
    // so design panels/strips are captured even in a headless (renderPreviews:false) import.
    // Running it BEFORE text extraction also populates page.commonObjs with the fonts, so we
    // can resolve each item's REAL font name (→ correct bold detection).
    const { images: imageOps, shapes: shapeOps, graphics: graphicOps } = await walkPage(page, (pdfjs as any).OPS, vp.height, vp.width);

    const resolveFont = (loadedName?: string): { name?: string; bold?: boolean } | undefined => {
      if (!loadedName) return undefined;
      try {
        const o = page.commonObjs.get(loadedName) as { name?: string; bold?: boolean; black?: boolean } | undefined;
        return o ? { name: o.name, bold: !!(o.bold || o.black) } : undefined;
      } catch { return undefined; }
    };
    const textBlocks = extractTextBlocks(tc, vp.height, id, resolveFont);
    // text sits in paint order ABOVE images (captions over photos)
    textBlocks.forEach((b, i) => { b.zIndex = 1_000_000 + i; });

    const overlapsBox = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      !(a.x > b.x + b.width || a.x + a.width < b.x || a.y > b.y + b.height || a.y + a.height < b.y);
    const lumOf = (hex?: string) => { const m = /^#(..)(..)(..)$/.exec(hex || ''); if (!m) return 1; const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    // A dark, FULLY-OPAQUE panel painted on top of (and covering most of) an image is almost always a
    // soft-mask / transparency-group darken-overlay whose real alpha we can't read — captured solid it
    // becomes a black block over the page. Drop it (the user can add a controllable scrim instead).
    const isOpaqueOverlay = (s: ShapeOp) => {
      if (s.alpha != null && s.alpha < 1) return false; // genuine semi-transparent → keep
      if (s.line || lumOf(s.fill) > 0.22) return false;  // only DARK opaque panels
      return imageOps.some((im) => {
        if (im.opIndex >= s.opIndex) return false; // shape must sit ON TOP of the image
        const ix = Math.max(0, Math.min(s.bbox.x + s.bbox.width, im.bbox.x + im.bbox.width) - Math.max(s.bbox.x, im.bbox.x));
        const iy = Math.max(0, Math.min(s.bbox.y + s.bbox.height, im.bbox.y + im.bbox.height) - Math.max(s.bbox.y, im.bbox.y));
        const imArea = im.bbox.width * im.bbox.height;
        return imArea > 0 && (ix * iy) / imArea > 0.5;
      });
    };
    const shapeBlocks: ShapeBlockIR[] = dedupeShapes(shapeOps)
      // an approximated gradient scrim is kept ONLY where it actually sits behind a text run
      .filter((s) => !s.shading || textBlocks.some((t) => !t.deleted && overlapsBox(s.bbox, t)))
      .filter((s) => !isOpaqueOverlay(s))
      .map((s, i) => ({
        id: `${id}_sh${i}`, type: 'shape', x: s.bbox.x, y: s.bbox.y, width: s.bbox.width, height: s.bbox.height,
        rotation: 0, zIndex: s.opIndex, source: 'original',
        originalBBox: { x: s.bbox.x, y: s.bbox.y, width: s.bbox.width, height: s.bbox.height },
        fill: s.fill, opacity: s.alpha,
      }));

    let previewImage: string | undefined;
    const imageBlocks: ImageBlockIR[] = [];
    const browser = typeof window !== 'undefined';
    if (opts.renderPreviews && (browser || opts.makeCanvas)) {
      const makeCanvas: MakeCanvas = opts.makeCanvas
        || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
      // The raster preview (for Compare + render-crop fallback) is browser-only; a Node
      // text render crashes pdf.js. Image OBJECT decoding works in both via makeCanvas.
      let rendered: Awaited<ReturnType<typeof renderPageCanvas>> | null = null;
      if (browser) {
        try { rendered = await renderPageCanvas(page, opts.previewScale ?? 2); previewImage = rendered.dataUrl; }
        catch (e) { console.warn('[import] preview render failed', e); }
      }
      // recover each text run's REAL colour by sampling its glyph pixels from the page raster
      // (getTextContent has no colour; this fixes coloured / white-on-dark headings).
      if (rendered) {
        const overlaps = (t: { x: number; y: number; width: number; height: number }, b: typeof t) =>
          !(t.x > b.x + b.width || t.x + t.width < b.x || t.y > b.y + b.height || t.y + t.height < b.y);
        const lum = (hex: string) => { const m = /^#(..)(..)(..)$/.exec(hex); if (!m) return 0; const [r, g, bl] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return (0.299 * r + 0.587 * g + 0.114 * bl) / 255; };
        for (const b of textBlocks) {
          if (b.deleted) continue;
          const col = sampleInkColor(rendered.canvas, rendered.scale, b);
          if (!col) continue;
          // a near-white colour only makes sense over a captured dark backdrop (shape/image); else
          // it would render invisible on the page — keep the default in that case.
          if (lum(col) > 0.82 && !shapeBlocks.some((s) => overlaps(b, s)) && !imageOps.some((im) => overlaps(b, im.bbox))) continue;
          b.color = col;
        }
      }
      for (let i = 0; i < imageOps.length; i++) {
        const op = imageOps[i];
        let src: string | null = null;
        try { src = await resolveImage(page, op, makeCanvas); } catch { /* unresolved */ }
        if (!src && rendered) {
          // last resort (browser only): crop preview but ERASE overlapping text
          const overlap = textBlocks.filter((t) => !(t.x + t.width < op.bbox.x || t.x > op.bbox.x + op.bbox.width || t.y + t.height < op.bbox.y || t.y > op.bbox.y + op.bbox.height));
          src = cropCanvasErasingText(rendered.canvas, rendered.scale, op.bbox, overlap);
          console.warn(`[import] RENDER-CROP FALLBACK fired on ${id} image op#${op.opIndex} (${op.name || 'inline'}) — clean source unresolved; text erased. Resolution has a gap.`);
        }
        if (!src) continue;
        imageBlocks.push({
          id: `${id}_img${i}`, type: 'image', x: op.bbox.x, y: op.bbox.y, width: op.bbox.width, height: op.bbox.height,
          rotation: 0, zIndex: op.opIndex, source: 'original',
          originalBBox: { x: op.bbox.x, y: op.bbox.y, width: op.bbox.width, height: op.bbox.height },
          src, originalImageRef: src, fit: 'cover', crop: op.crop,
        });
      }

      // Vector graphics (logos / QR / colour scales) can't be rebuilt as primitives → rasterize
      // each detected region from the page render to a sharp PNG. We BAKE the whole region (so a
      // scale's white-on-colour numbers keep their real colour) and then drop the now-redundant
      // text runs fully inside it, to avoid doubling. Browser-only (needs the page canvas).
      if (rendered) {
        const within = (t: { x: number; y: number; width: number; height: number }, b: typeof t) =>
          t.x >= b.x - 1 && t.y >= b.y - 1 && t.x + t.width <= b.x + b.width + 1 && t.y + t.height <= b.y + b.height + 1;
        graphicOps.forEach((g, gi) => {
          const src = cropGraphic(rendered!.canvas, rendered!.scale, g.bbox, []);
          if (!src) return;
          imageBlocks.push({
            id: `${id}_gfx${gi}`, type: 'image', x: g.bbox.x, y: g.bbox.y, width: g.bbox.width, height: g.bbox.height,
            rotation: 0, zIndex: 900_000 + gi, source: 'original',
            originalBBox: { x: g.bbox.x, y: g.bbox.y, width: g.bbox.width, height: g.bbox.height },
            src, originalImageRef: src, fit: 'contain',
          });
          // only a colour scale bakes its own (white-on-colour) numbers → drop those text runs;
          // logos/QR/generic graphics carry no real text, so never remove editable text under them.
          if (g.kind === 'scale') for (const t of textBlocks) if (within(t, g.bbox)) t.deleted = true;
        });
      }
    }

    pages.push({
      id,
      width: Math.round(vp.width),
      height: Math.round(vp.height),
      rotation: vp.rotation || 0,
      originalPdfPageIndex: n - 1,
      previewImage,
      // paint order: shapes (under) → images → text (on top); each keeps its op-order zIndex
      blocks: [...shapeBlocks, ...dedupeImages(imageBlocks), ...textBlocks],
    });
  }

  // (helper hoisted below)
  const n = sourcePdfName.toLowerCase();
  const brand = /peugeot|208|2008|3008|5008|rifter|boxer/.test(n) ? 'peugeot'
    : /citroen|citro|c3|c4|c5|berlingo|jumpy/.test(n) ? 'citroen'
    : /opel|corsa|astra|mokka|grandland|crossland|combo|zafira|insignia|vivaro|frontera/.test(n) ? 'opel'
    : (/\bmg(s\d|[_\s-](hs|zs|ehs|phev)|\d)/i.test(n) || /\bmg\b/i.test(n)) ? 'mg' : 'unknown';

  return {
    id: `doc_${Date.now()}`,
    sourcePdfName,
    brand,
    pages,
  };
}

/**
 * Drop duplicate image ops painted at the same spot. pdf.js often emits, for one SMasked
 * picture, BOTH a transparent RGBA version (→ PNG) and an opaque RGB version whose masked-out
 * background is BLACK (→ JPEG). Keeping the black one produced black boxes around cut-out cars.
 * Prefer the alpha PNG; otherwise the larger source.
 */
function dedupeImages(imgs: ImageBlockIR[]): ImageBlockIR[] {
  const bb = (b: ImageBlockIR): BBox => ({ x: b.x, y: b.y, width: b.width, height: b.height });
  const keep: ImageBlockIR[] = [];
  for (const im of imgs) {
    const di = keep.findIndex((k) => iou(bb(k), bb(im)) > 0.8);
    if (di === -1) { keep.push(im); continue; }
    const cur = keep[di];
    const curPng = cur.src.startsWith('data:image/png');
    const imPng = im.src.startsWith('data:image/png');
    if (curPng !== imPng) keep[di] = curPng ? cur : im; // prefer the alpha (PNG) version
    else if (im.width * im.height > cur.width * cur.height) keep[di] = im; // else the larger
  }
  return keep;
}

/** Merge near-duplicate filled panels (cap 50 by area) and keep distinct rules/lines (cap 400). */
function dedupeShapes(shapes: ShapeOp[]): ShapeOp[] {
  const panels: ShapeOp[] = [];
  for (const s of shapes.filter((x) => !x.line)) {
    const dup = panels.find((o) => o.fill === s.fill && iou(o.bbox, s.bbox) > 0.85);
    if (dup) { if (area(s.bbox) > area(dup.bbox)) Object.assign(dup, s); continue; }
    panels.push({ ...s });
  }
  const lines: ShapeOp[] = [];
  for (const s of shapes.filter((x) => x.line)) {
    if (lines.some((o) => o.fill === s.fill && iou(o.bbox, s.bbox) > 0.6)) continue;
    lines.push({ ...s });
  }
  return [
    ...panels.sort((a, b) => area(b.bbox) - area(a.bbox)).slice(0, 50),
    ...lines.slice(0, 400),
  ];
}
function area(b: { width: number; height: number }): number { return b.width * b.height; }
function iou(a: ShapeOp['bbox'], b: ShapeOp['bbox']): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = area(a) + area(b) - inter;
  return uni <= 0 ? 0 : inter / uni;
}
