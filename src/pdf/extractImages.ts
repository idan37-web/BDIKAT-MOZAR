// Stage 5 fix (image/text separation): walk the pdf.js operator list ONCE with a CTM
// stack and resolve a CLEAN pixel source for every painted image — never the flattened
// render-crop (which carries baked text). Resolution order per region:
//   (i)  inline image data (paintInlineImageXObject — no string objId)
//   (ii) named XObject from page.objs, resolved via the await/callback form (works even
//        after the browser releases objects post-render — we read after getOperatorList)
//   (iii) image-mask stencil -> RGBA
// Image objects never contain text; overlapping text stays a separate block (paint order).
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(a: Mat, b: Mat): Mat {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function apply(m: Mat, x: number, y: number): [number, number] { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

export interface ImageOp {
  opIndex: number;
  bbox: { x: number; y: number; width: number; height: number }; // PDF points, top-left
  name?: string;     // named XObject objId
  inline?: any;      // inline image object (paintInlineImageXObject)
  mask?: boolean;    // paintImageMaskXObject (stencil)
  hadSMask?: boolean;
}

/** A vector rectangle: a filled panel/strip, or a thin stroked line (table gridline). */
export interface ShapeOp {
  opIndex: number;
  bbox: { x: number; y: number; width: number; height: number };
  fill: string; // "#rrggbb"
  line?: boolean; // true = a stroked rule/gridline (render as a thin rect of `fill`)
}

export interface PageOps { images: ImageOp[]; shapes: ShapeOp[]; }

export type MakeCanvas = (w: number, h: number) => HTMLCanvasElement;

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
}

/**
 * Single operator-list walk for import (hard rule): collects BOTH painted images and
 * filled rectangles (design panels/strips) in one pass with a shared CTM stack. Shape
 * colours come straight from the fill colour ops (no raster sampling needed).
 */
export async function walkPage(page: any, OPS: any, pageHeight: number): Promise<PageOps> {
  const ol = await page.getOperatorList();
  const fns: number[] = ol.fnArray; const args: any[] = ol.argsArray;
  let ctm: Mat = [...IDENT] as Mat; const stack: Mat[] = [];
  let smaskActive = false;
  let fill = '#000000';
  let strokeCol = '#000000';
  let pathBox: number[] | null = null; // [minX,minY,maxX,maxY] in path space (constructPath args[2])
  const images: ImageOp[] = [];
  const shapes: ShapeOp[] = [];
  const isXObj = (fn: number) => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat;
  const isFill = (fn: number) => fn === OPS.fill || fn === OPS.eoFill;
  const isStroke = (fn: number) => fn === OPS.stroke || fn === OPS.closeStroke;
  const isFillStroke = (fn: number) => fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke;

  const xform = (box: number[]) => {
    const [x0, y0] = apply(ctm, box[0], box[1]);
    const [x1, y1] = apply(ctm, box[2], box[3]);
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  };

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], a = args[i];
    if (fn === OPS.save) stack.push([...ctm] as Mat);
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop() as Mat; }
    else if (fn === OPS.transform) ctm = mul(ctm, a as Mat);
    else if (fn === OPS.setGState) { try { smaskActive = JSON.stringify(a).includes('SMask') ? !JSON.stringify(a).includes('"None"') : smaskActive; } catch { /* ignore */ } }
    else if (fn === OPS.setFillRGBColor) { const c = a as number[]; fill = toHex(c[0], c[1], c[2]); }
    else if (fn === OPS.setFillGray) { const g = (a as number[])[0]; const v = g <= 1 ? g * 255 : g; fill = toHex(v, v, v); }
    else if (fn === OPS.setFillCMYKColor) { const [c, m, y, k] = a as number[]; const [r, g, b] = cmykToRgb(c, m, y, k); fill = toHex(r, g, b); }
    else if (fn === OPS.setStrokeRGBColor) { const c = a as number[]; strokeCol = toHex(c[0], c[1], c[2]); }
    else if (fn === OPS.setStrokeGray) { const g = (a as number[])[0]; const v = g <= 1 ? g * 255 : g; strokeCol = toHex(v, v, v); }
    else if (fn === OPS.setStrokeCMYKColor) { const [c, m, y, k] = a as number[]; const [r, g, b] = cmykToRgb(c, m, y, k); strokeCol = toHex(r, g, b); }
    else if (fn === OPS.constructPath) { pathBox = Array.isArray(a) ? (a[2] as number[]) : null; }
    else if (isFill(fn) || isFillStroke(fn)) {
      if (pathBox && pathBox.length === 4) {
        const { minX, maxY, w, h } = xform(pathBox);
        // significant, non-white panels only (white == page background → noise)
        if (w >= 24 && h >= 10 && fill.toLowerCase() !== '#ffffff') {
          shapes.push({ opIndex: i, fill, bbox: { x: Math.round(minX), y: Math.round(pageHeight - maxY), width: Math.round(w), height: Math.round(h) } });
        }
      }
      pathBox = null;
    } else if (isStroke(fn)) {
      if (pathBox && pathBox.length === 4) {
        const { minX, maxY, w, h } = xform(pathBox);
        // thin long stroke = a table rule / gridline → a thin rect of the stroke colour
        const thin = Math.min(w, h) <= 2.5;
        const long = Math.max(w, h) >= 8;
        if (thin && long) {
          shapes.push({ opIndex: i, fill: strokeCol, line: true, bbox: { x: Math.round(minX), y: Math.round(pageHeight - maxY), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) } });
        } else if (!thin && w >= 24 && h >= 10) {
          // a stroked rectangle outline (kept as a faint panel border via the line colour)
          shapes.push({ opIndex: i, fill: strokeCol, line: true, bbox: { x: Math.round(minX), y: Math.round(pageHeight - maxY), width: Math.round(w), height: 1 } });
        }
      }
      pathBox = null;
    } else if (fn === OPS.endPath) { pathBox = null; }
    else if (isXObj(fn) || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX, h = maxY - minY;
      if (w < 20 || h < 20) continue;
      const bbox = { x: Math.round(minX), y: Math.round(pageHeight - maxY), width: Math.round(w), height: Math.round(h) };
      if (fn === OPS.paintInlineImageXObject) images.push({ opIndex: i, bbox, inline: a?.[0], hadSMask: smaskActive });
      else if (fn === OPS.paintImageMaskXObject) images.push({ opIndex: i, bbox, name: Array.isArray(a) && typeof a[0] === 'string' ? a[0] : undefined, mask: true, hadSMask: smaskActive });
      else images.push({ opIndex: i, bbox, name: Array.isArray(a) && typeof a[0] === 'string' ? a[0] : undefined, hadSMask: smaskActive });
    }
  }
  return { images, shapes };
}

/** Back-compat thin wrapper (image-only callers). */
export async function walkPageImages(page: any, OPS: any, pageHeight: number): Promise<ImageOp[]> {
  return (await walkPage(page, OPS, pageHeight)).images;
}

function getObj(page: any, name: string): Promise<any> {
  return new Promise((resolve) => {
    let done = false;
    try {
      if (page.objs.has(name)) { resolve(page.objs.get(name)); return; }
      page.objs.get(name, (o: any) => { done = true; resolve(o); });
    } catch { resolve(null); return; }
    setTimeout(() => { if (!done) resolve(null); }, 4000);
  });
}

export function objToDataUrl(o: any, makeCanvas: MakeCanvas): string | null {
  if (!o) return null;
  const bmp = o.bitmap ?? (typeof ImageBitmap !== 'undefined' && o instanceof ImageBitmap ? o : null);
  const W = o.width ?? bmp?.width; const H = o.height ?? bmp?.height;
  if (!W || !H) return null;
  const c = makeCanvas(W, H); const ctx = c.getContext('2d'); if (!ctx) return null;
  let hasAlpha = false;
  if (bmp) {
    ctx.drawImage(bmp, 0, 0);
    // CRITICAL: in the browser pdf.js hands us an ImageBitmap (this branch). We MUST detect
    // transparency here — otherwise an SMasked swatch (transparent background) gets saved as
    // opaque JPEG and its transparent areas turn BLACK. Read the pixels back to check alpha.
    try {
      const data = ctx.getImageData(0, 0, W, H).data;
      for (let q = 3; q < data.length; q += 4) { if (data[q] < 255) { hasAlpha = true; break; } }
    } catch { hasAlpha = true; /* if we can't sample, keep PNG (lossless, preserves alpha) */ }
  } else if (o.data) {
    const d: Uint8ClampedArray = o.data; const rgba = new Uint8ClampedArray(W * H * 4);
    if (d.length === W * H * 4) { rgba.set(d); for (let q = 3; q < rgba.length; q += 4) if (rgba[q] < 255) { hasAlpha = true; break; } }
    else if (d.length === W * H * 3) { for (let p = 0, q = 0; p < d.length; p += 3, q += 4) { rgba[q] = d[p]; rgba[q + 1] = d[p + 1]; rgba[q + 2] = d[p + 2]; rgba[q + 3] = 255; } }
    else if (d.length === W * H) { for (let p = 0, q = 0; p < d.length; p++, q += 4) { rgba[q] = rgba[q + 1] = rgba[q + 2] = d[p]; rgba[q + 3] = 255; } }
    else return null;
    ctx.putImageData(new ImageData(rgba, W, H), 0, 0);
  } else return null;
  // keep transparency as PNG; opaque photos as smaller JPEG
  return c.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.85);
}

/** Resolve a clean pixel source (data URL) for an image op, or null if impossible. */
export async function resolveImage(page: any, op: ImageOp, makeCanvas: MakeCanvas): Promise<string | null> {
  // (i) inline image
  if (op.inline) {
    const o = op.inline;
    const norm = o.bitmap || o.data ? o : (o.width && o.height ? o : null);
    const url = objToDataUrl(norm, makeCanvas);
    if (url) return url;
  }
  // (ii)/(iii) named XObject or mask
  if (op.name) {
    const o = await getObj(page, op.name);
    const url = objToDataUrl(o, makeCanvas);
    if (url) return url;
  }
  return null;
}
