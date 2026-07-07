// T5 (Reference Playbook, gated) — glyph-OUTLINE export: draw each glyph of a (visual-order)
// line as vector path outlines via fontkit `layout()` (which applies GSUB/GPOS, so niqqud
// marks position correctly). Output is independent of any viewer's font handling — a print
// master — at the cost of selectable text. Default export stays T4 text mode; this runs only
// under `exportMode: 'outlines'`.
import fontkit from '@pdf-lib/fontkit';
import type { PDFPage, RGB } from 'pdf-lib';

interface FkGlyph { path: { scale: (x: number, y: number) => { toSVG: () => string } }; }
interface FkPosition { xAdvance: number; xOffset: number; yOffset: number; }
interface FkFont { unitsPerEm: number; layout: (s: string, f?: undefined, script?: string, lang?: undefined, dir?: string) => { glyphs: FkGlyph[]; positions: FkPosition[] }; }

/** Parse font bytes once per export run. */
export function openFont(bytes: Uint8Array): FkFont {
  return (fontkit as unknown as { create: (b: Uint8Array) => FkFont }).create(bytes);
}

/** Total advance width of a visual line at `sizePt` (outline metrics — no PDFFont needed). */
export function outlineLineWidth(font: FkFont, visualLine: string, sizePt: number): number {
  const run = font.layout(visualLine, undefined, 'hebr', undefined, 'ltr');
  const s = sizePt / font.unitsPerEm;
  return run.positions.reduce((sum, p) => sum + p.xAdvance * s, 0);
}

/**
 * Draw one VISUAL-order line as glyph outlines. `originX` is the LEFT x of the run,
 * `baselineY` in pdf-lib coordinates (bottom-left origin, y-up).
 * The line is already in visual order (T4), so we lay glyphs strictly left→right —
 * direction 'ltr' stops fontkit from re-reversing what bidi already ordered.
 */
export function drawLineOutlines(
  page: PDFPage, font: FkFont, visualLine: string,
  originX: number, baselineY: number, sizePt: number, color: RGB,
): void {
  const run = font.layout(visualLine, undefined, 'hebr', undefined, 'ltr');
  const s = sizePt / font.unitsPerEm;
  let penX = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i], p = run.positions[i];
    const svg = g.path.scale(s, -s).toSVG(); // flip Y: font is y-up, drawSvgPath expects y-down
    if (svg) {
      page.drawSvgPath(svg, { x: originX + penX + p.xOffset * s, y: baselineY - p.yOffset * s, color, borderWidth: 0 });
    }
    penX += p.xAdvance * s;
  }
}
