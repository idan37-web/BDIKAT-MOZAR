// Image effects baked onto the pixels (so the editor preview and the exported PDF match exactly).
// Both preserve any existing transparency (e.g. after background removal) by restoring the original
// alpha channel after the effect. Browser/canvas only.
import type { DocumentIR } from '../types/catalog';

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setup(img: HTMLImageElement): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return { c, ctx, w, h };
}

/** Copy the alpha channel from `orig` back onto the current canvas pixels (keeps cut-outs cut out). */
function restoreAlpha(ctx: CanvasRenderingContext2D, w: number, h: number, orig: Uint8ClampedArray) {
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) d[i] = orig[i];
  ctx.putImageData(data, 0, 0);
}

/** Recolour an image toward `color`. strength 0..1. Uses a blend that keeps detail; transparency kept. */
export async function tintImage(src: string, color: string, strength = 0.5, mode: 'multiply' | 'color' = 'color'): Promise<string> {
  const img = await load(src);
  const s = setup(img); if (!s) return src;
  const { c, ctx, w, h } = s;
  const orig = ctx.getImageData(0, 0, w, h).data.slice();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = Math.max(0, Math.min(1, strength));
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  restoreAlpha(ctx, w, h, orig);
  return c.toDataURL('image/png');
}

/** Darken an image from the edges inward (vignette). strength 0..1 = edge darkness. Transparency kept. */
export async function vignetteImage(src: string, strength = 0.5): Promise<string> {
  const img = await load(src);
  const s = setup(img); if (!s) return src;
  const { c, ctx, w, h } = s;
  const orig = ctx.getImageData(0, 0, w, h).data.slice();
  const cx = w / 2, cy = h / 2;
  const outer = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, outer * 0.42, cx, cy, outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${Math.max(0, Math.min(0.95, strength))})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  restoreAlpha(ctx, w, h, orig);
  return c.toDataURL('image/png');
}

export interface EdgeShade { top: number; right: number; bottom: number; left: number }

/** CSS background (stacked linear-gradients) for live per-edge darkening — each edge fades inward. */
export function edgeShadeBackground(e: EdgeShade): string {
  const parts: string[] = [];
  if (e.top > 0) parts.push(`linear-gradient(to bottom, rgba(0,0,0,${e.top}), rgba(0,0,0,0) 42%)`);
  if (e.bottom > 0) parts.push(`linear-gradient(to top, rgba(0,0,0,${e.bottom}), rgba(0,0,0,0) 42%)`);
  if (e.left > 0) parts.push(`linear-gradient(to right, rgba(0,0,0,${e.left}), rgba(0,0,0,0) 42%)`);
  if (e.right > 0) parts.push(`linear-gradient(to left, rgba(0,0,0,${e.right}), rgba(0,0,0,0) 42%)`);
  return parts.join(', ');
}

const hasShade = (e?: EdgeShade) => !!e && (e.top > 0 || e.right > 0 || e.bottom > 0 || e.left > 0);

/** Bake per-edge darkening onto the pixels (for export). Mirrors edgeShadeBackground. Alpha kept. */
export async function bakeEdgeShade(src: string, e: EdgeShade): Promise<string> {
  if (!hasShade(e)) return src;
  const img = await load(src);
  const s = setup(img); if (!s) return src;
  const { c, ctx, w, h } = s;
  const orig = ctx.getImageData(0, 0, w, h).data.slice();
  const grad = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.42, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  };
  if (e.top > 0) grad(0, 0, 0, h, e.top);
  if (e.bottom > 0) grad(0, h, 0, 0, e.bottom);
  if (e.left > 0) grad(0, 0, w, 0, e.left);
  if (e.right > 0) grad(w, 0, 0, 0, e.right);
  restoreAlpha(ctx, w, h, orig);
  return c.toDataURL('image/png');
}

/** Bake every image's live per-edge shade into its pixels → a doc clone ready for vector export
 * (the editor keeps the shade non-destructive; this is only applied to the exported copy). */
export async function bakeDocEdgeShades(doc: DocumentIR): Promise<DocumentIR> {
  const pages = await Promise.all(doc.pages.map(async (p) => ({
    ...p,
    blocks: await Promise.all(p.blocks.map(async (b) => {
      if (b.type === 'image' && hasShade((b as any).edgeShade)) {
        const src = await bakeEdgeShade((b as any).src, (b as any).edgeShade as EdgeShade);
        return { ...b, src };
      }
      return b;
    })),
  })));
  return { ...doc, pages };
}
