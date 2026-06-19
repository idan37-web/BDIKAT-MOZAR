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

export type MakeCanvas = (w: number, h: number) => HTMLCanvasElement;

export async function walkPageImages(page: any, OPS: any, pageHeight: number): Promise<ImageOp[]> {
  const ol = await page.getOperatorList();
  const fns: number[] = ol.fnArray; const args: any[] = ol.argsArray;
  let ctm: Mat = [...IDENT] as Mat; const stack: Mat[] = [];
  let smaskActive = false;
  const out: ImageOp[] = [];
  const isXObj = (fn: number) => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat;
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i], a = args[i];
    if (fn === OPS.save) stack.push([...ctm] as Mat);
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop() as Mat; }
    else if (fn === OPS.transform) ctm = mul(ctm, a as Mat);
    else if (fn === OPS.setGState) { try { smaskActive = JSON.stringify(a).includes('SMask') ? !JSON.stringify(a).includes('"None"') : smaskActive; } catch { /* ignore */ } }
    else if (isXObj(fn) || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX, h = maxY - minY;
      if (w < 20 || h < 20) continue;
      const bbox = { x: Math.round(minX), y: Math.round(pageHeight - maxY), width: Math.round(w), height: Math.round(h) };
      if (fn === OPS.paintInlineImageXObject) out.push({ opIndex: i, bbox, inline: a?.[0], hadSMask: smaskActive });
      else if (fn === OPS.paintImageMaskXObject) out.push({ opIndex: i, bbox, name: Array.isArray(a) && typeof a[0] === 'string' ? a[0] : undefined, mask: true, hadSMask: smaskActive });
      else out.push({ opIndex: i, bbox, name: Array.isArray(a) && typeof a[0] === 'string' ? a[0] : undefined, hadSMask: smaskActive });
    }
  }
  return out;
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

function objToDataUrl(o: any, makeCanvas: MakeCanvas): string | null {
  if (!o) return null;
  const bmp = o.bitmap ?? (typeof ImageBitmap !== 'undefined' && o instanceof ImageBitmap ? o : null);
  const W = o.width ?? bmp?.width; const H = o.height ?? bmp?.height;
  if (!W || !H) return null;
  const c = makeCanvas(W, H); const ctx = c.getContext('2d'); if (!ctx) return null;
  let hasAlpha = false;
  if (bmp) { ctx.drawImage(bmp, 0, 0); }
  else if (o.data) {
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
