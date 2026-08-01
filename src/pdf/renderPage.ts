// Stage 5 (C.7): render a pdf.js page to a raster preview and KEEP the canvas so image
// blocks can be cut from it (reference/compare layer + source of image crops).
interface PdfPageLike {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

export interface RenderedPage {
  dataUrl: string;
  canvas: HTMLCanvasElement;
  scale: number;
}

export async function renderPageCanvas(page: PdfPageLike, scale = 2): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), canvas, scale };
}

/**
 * Sample the INK colour of a text run from the rendered page raster. `getTextContent` carries no
 * colour, so we read the glyph pixels: background = the region's border average; ink = the average
 * of pixels far from that background. Returns a "#rrggbb" only when the ink is a CONFIDENT single
 * colour (enough ink pixels + low variance) — otherwise null, so noisy text-over-photo keeps the
 * default. bbox is in PDF points, top-left origin.
 */
export function sampleInkColor(
  canvas: HTMLCanvasElement, scale: number, bbox: { x: number; y: number; width: number; height: number },
): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const sx = Math.max(0, Math.floor(bbox.x * scale));
  const sy = Math.max(0, Math.floor(bbox.y * scale));
  const sw = Math.min(canvas.width - sx, Math.ceil(bbox.width * scale));
  const sh = Math.min(canvas.height - sy, Math.ceil(bbox.height * scale));
  if (sw < 3 || sh < 3) return null;
  let img: ImageData;
  try { img = ctx.getImageData(sx, sy, sw, sh); } catch { return null; }
  const d = img.data;
  // background = average of the region's border pixels
  let R = 0, G = 0, B = 0, bn = 0;
  const addB = (x: number, y: number) => { const i = (y * sw + x) * 4; R += d[i]; G += d[i + 1]; B += d[i + 2]; bn++; };
  for (let x = 0; x < sw; x++) { addB(x, 0); addB(x, sh - 1); }
  for (let y = 1; y < sh - 1; y++) { addB(0, y); addB(sw - 1, y); }
  const bg = [R / bn, G / bn, B / bn];
  const FAR = 55 * 55 * 3;
  // ink = pixels far from bg
  let ir = 0, ig = 0, ib = 0, k = 0;
  const n = sw * sh;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db > FAR) { ir += d[i]; ig += d[i + 1]; ib += d[i + 2]; k++; }
  }
  if (k < n * 0.02) return null; // too little ink to be sure
  const ink = [ir / k, ig / k, ib / k];
  // variance of ink pixels around the mean — high = mixed colours (over a photo) → unreliable
  let v = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db > FAR) {
      const er = d[i] - ink[0], eg = d[i + 1] - ink[1], eb = d[i + 2] - ink[2];
      v += er * er + eg * eg + eb * eb;
    }
  }
  if (v / k > 70 * 70 * 3) return null;
  const hex = '#' + ink.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
  return hex;
}

/** Crop a region (in PDF points, top-left origin) out of the rendered canvas → data URL. */
export function cropCanvas(canvas: HTMLCanvasElement, scale: number, x: number, y: number, w: number, h: number): string {
  const sx = Math.max(0, Math.round(x * scale));
  const sy = Math.max(0, Math.round(y * scale));
  const sw = Math.min(canvas.width - sx, Math.round(w * scale));
  const sh = Math.min(canvas.height - sy, Math.round(h * scale));
  if (sw <= 0 || sh <= 0) return '';
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/jpeg', 0.85);
}

/**
 * Crop a VECTOR-GRAPHIC region (logo / QR / colour scale) out of the page raster as a sharp
 * PNG, erasing overlapping text (numbers/labels) so they aren't baked twice — the real text
 * blocks render on top. PNG (not JPEG) keeps logo/QR edges crisp.
 */
export function cropGraphic(
  canvas: HTMLCanvasElement, scale: number,
  rect: { x: number; y: number; width: number; height: number },
  eraseRectsPoints: { x: number; y: number; width: number; height: number }[],
): string {
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(canvas.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(canvas.height - sy, Math.round(rect.height * scale));
  if (sw <= 2 || sh <= 2) return '';
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d'); if (!ctx) return '';
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.fillStyle = '#ffffff';
  for (const e of eraseRectsPoints) {
    const ex = Math.round(e.x * scale) - sx - 1;
    const ey = Math.round(e.y * scale) - sy - 1;
    ctx.fillRect(ex, ey, Math.round(e.width * scale) + 2, Math.round(e.height * scale) + 2);
  }
  return c.toDataURL('image/png');
}

/**
 * LAST-RESORT fallback only: crop the region but ERASE (white-out) any overlapping text
 * rectangles so the crop can NEVER carry text. Used only when no clean image source
 * exists; the caller must log loudly (it means image resolution has a gap to close).
 */
export function cropCanvasErasingText(
  canvas: HTMLCanvasElement, scale: number,
  rect: { x: number; y: number; width: number; height: number },
  eraseRectsPoints: { x: number; y: number; width: number; height: number }[],
): string {
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(canvas.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(canvas.height - sy, Math.round(rect.height * scale));
  if (sw <= 0 || sh <= 0) return '';
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d'); if (!ctx) return '';
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.fillStyle = '#ffffff';
  for (const e of eraseRectsPoints) {
    const ex = Math.round(e.x * scale) - sx - 2;
    const ey = Math.round(e.y * scale) - sy - 2;
    ctx.fillRect(ex, ey, Math.round(e.width * scale) + 4, Math.round(e.height * scale) + 4);
  }
  return c.toDataURL('image/jpeg', 0.85);
}
