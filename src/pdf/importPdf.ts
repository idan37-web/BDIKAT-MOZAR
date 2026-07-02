// Stage 2 (C.4): turn an uploaded PDF (ArrayBuffer) into a DocumentIR using pdf.js.
// The imported IR — never IMPORT3008/IMPORTC3 — is the source of truth after upload.
import type { BBox, DocumentIR, PageIR, ImageBlockIR, ShapeBlockIR } from '../types/catalog';
import { extractTextBlocks, clusterTextBlocks } from './extractLayout';
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
    // cluster raw runs into lines/paragraphs (logical order preserved; tables stay per-cell)
    const textBlocks = clusterTextBlocks(extractTextBlocks(tc, vp.height, id, resolveFont));
    // text sits in paint order ABOVE images (captions over photos)
    textBlocks.forEach((b, i) => { b.zIndex = 1_000_000 + i; });

    const lumOf = (hex?: string) => { const m = /^#(..)(..)(..)$/.exec(hex || ''); if (!m) return 1; const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    // A dark, FULLY-OPAQUE panel painted on top of (and covering most of) an image is almost always a
    // soft-mask / transparency-group darken-overlay whose real alpha we can't read — captured solid it
    // becomes a black block over the page. Drop it (the user can add a controllable scrim instead).
    const isOpaqueOverlay = (s: ShapeOp) => {
      if (s.alpha != null && s.alpha < 1) return false; // genuine semi-transparent → keep
      if (s.line || lumOf(s.fill) > 0.9) return false;   // keep near-white cards; drop dark/grey overlays
      return imageOps.some((im) => {
        if (im.opIndex >= s.opIndex) return false; // shape must sit ON TOP of the image
        const ix = Math.max(0, Math.min(s.bbox.x + s.bbox.width, im.bbox.x + im.bbox.width) - Math.max(s.bbox.x, im.bbox.x));
        const iy = Math.max(0, Math.min(s.bbox.y + s.bbox.height, im.bbox.y + im.bbox.height) - Math.max(s.bbox.y, im.bbox.y));
        const imArea = im.bbox.width * im.bbox.height;
        if (imArea > 0 && (ix * iy) / imArea > 0.55) return true; // covers most of the image
        // OR: a full-bleed dark BAND lying entirely on the image (e.g. a header strip whose real
        // shape came from a non-rect clip we can't represent — invisible in the source)
        const sArea = s.bbox.width * s.bbox.height;
        return sArea > 0 && (ix * iy) / sArea > 0.9 && s.bbox.width >= im.bbox.width * 0.85 && lumOf(s.fill) <= 0.16;
      });
    };
    // A near-full-page WHITE fill is the page background being re-painted: it ERASES every
    // earlier shape it covers (they're fully occluded in the source — e.g. a black header bar
    // later painted over). Apply the erasers, then drop them (white bg is the page default).
    let visibleShapeOps = shapeOps;
    for (const bg of shapeOps.filter((s) => s.bgWhite)) {
      visibleShapeOps = visibleShapeOps.filter((s) => {
        if (s === bg || s.opIndex >= bg.opIndex) return true;
        // compare the shape's VISIBLE (page-clamped) part — a bar hanging off-page still counts
        const sx0 = Math.max(0, s.bbox.x), sy0 = Math.max(0, s.bbox.y);
        const sx1 = Math.min(vp.width, s.bbox.x + s.bbox.width), sy1 = Math.min(vp.height, s.bbox.y + s.bbox.height);
        const inside = sx0 >= bg.bbox.x - 2 && sy0 >= bg.bbox.y - 2
          && sx1 <= bg.bbox.x + bg.bbox.width + 2 && sy1 <= bg.bbox.y + bg.bbox.height + 2;
        return !inside;
      });
    }
    visibleShapeOps = visibleShapeOps.filter((s) => !s.bgWhite);
    // a fill painted under a soft mask is NOT the flat colour the page shows (the mask turns it
    // into a gradient/shaped overlay we cannot reproduce) — exclude it BEFORE dedupe so a masked
    // duplicate can never merge into (and poison) a real panel. Same for opaque full-cover overlays.
    let shapeBlocks: ShapeBlockIR[] = dedupeShapes(visibleShapeOps.filter((s) => !s.masked))
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
        // an image painted inside a Luminosity soft-mask group is the MASK's own pixels (a
        // gradient bitmap), not page content — decoding it opaque paints a solid gradient BAR
        // over the photo. Exclude it, like masked fills.
        if (op.masked) continue;
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

        // Vector LOGOS / wordmarks / QR / badges are often captured as crude MONO (white/black)
        // solid-fill RECTANGLES — which render as ugly blocks. Cluster those mono fills and replace
        // each cluster with a faithful raster crop of the page render (real glyph pixels), dropping
        // the rectangles. Colours panels (design) are left as editable shapes.
        const pageArea = vp.width * vp.height;
        const mono = (hex?: string) => { const L = lumOf(hex); return L >= 0.85 || (L >= 0 && L <= 0.16); };
        const logoish = shapeBlocks.filter((s) =>
          !!s.fill && mono(s.fill) && Math.min(s.width, s.height) >= 5 && Math.max(s.width, s.height) <= 360
          && s.width * s.height <= pageArea * 0.10 && (s.opacity == null || s.opacity >= 1));
        if (logoish.length) {
          const GAP = 60;
          const par = logoish.map((_, i) => i);
          const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
          const near = (a: ShapeBlockIR, b: ShapeBlockIR) => {
            const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
            const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
            return dx <= GAP && dy <= GAP;
          };
          for (let i = 0; i < logoish.length; i++) for (let j = i + 1; j < logoish.length; j++) if (near(logoish[i], logoish[j])) par[find(i)] = find(j);
          const groups = new Map<number, ShapeBlockIR[]>();
          logoish.forEach((s, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(s); });
          const drop = new Set<string>();
          let li = 0;
          for (const grp of groups.values()) {
            const x0 = Math.min(...grp.map((s) => s.x)), y0 = Math.min(...grp.map((s) => s.y));
            const x1 = Math.max(...grp.map((s) => s.x + s.width)), y1 = Math.max(...grp.map((s) => s.y + s.height));
            const core = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }; // UNpadded — for text de-dup below
            let bbox = { ...core };
            if (bbox.width < 10 || bbox.height < 8 || bbox.width * bbox.height > pageArea * 0.2) continue;
            // PAD the crop region: the solid fills are tighter than the rendered glyph (strokes,
            // anti-aliasing, the diaeresis/chevron tips), so a tight crop cuts the logo. Pad and
            // clamp to the page; the surrounding (uniform) background blends with the page.
            const pad = Math.max(4, Math.round(Math.min(bbox.width, bbox.height) * 0.18));
            const px = Math.max(0, bbox.x - pad), py = Math.max(0, bbox.y - pad);
            bbox = { x: px, y: py, width: Math.min(vp.width - px, bbox.width + pad * 2), height: Math.min(vp.height - py, bbox.height + pad * 2) };
            const src = cropGraphic(rendered!.canvas, rendered!.scale, bbox, []);
            if (!src) continue;
            imageBlocks.push({
              id: `${id}_logo${li}`, type: 'image', x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height,
              rotation: 0, zIndex: 901_000 + li, source: 'original',
              originalBBox: { ...bbox }, src, originalImageRef: src, fit: 'contain',
            });
            li++;
            grp.forEach((s) => drop.add(s.id));
            // the baked raster CONTAINS its own text (a badge like "5 שנות אחריות") — drop the
            // now-duplicate editable runs that sit fully inside the CORE (unpadded) region
            for (const t of textBlocks) {
              if (t.deleted) continue;
              if (t.x >= core.x - 1 && t.y >= core.y - 1 && t.x + t.width <= core.x + core.width + 1 && t.y + t.height <= core.y + core.height + 1) t.deleted = true;
            }
            if (li > 60) break;
          }
          if (drop.size) shapeBlocks = shapeBlocks.filter((s) => !drop.has(s.id));
        }
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
