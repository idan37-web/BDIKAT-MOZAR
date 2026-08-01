// T3 (Reference Playbook) — editor overlay math, adopted verbatim from pdf.js text_layer.js /
// editor/editor.js. Three rules that kill drift at every zoom:
//   1. Block positions are stored/rendered as PERCENTAGES of the page container (pdf.js editors
//      keep x,y as fractions of page dimensions) — zooming rescales the container and everything
//      follows; no per-block JS repositioning ever runs on zoom.
//   2. Font size is `calc(sizePt px * var(--scale-factor))` — zoom = ONE CSS variable update on
//      the page container (the pdf.js `--scale-factor` contract).
//   3. Width correction for font-metric mismatch (reference text layers only): measure with
//      canvas measureText and apply `transform: scaleX(pdfWidth·scale / measured)`.
import type { CSSProperties } from 'react';

/** One dimension as a percentage of its page dimension (pdf.js #layout uses toFixed(2); we keep
 * two extra digits so sub-pixel positions survive on very large pages). */
export function pct(v: number, total: number): string {
  return `${((100 * v) / Math.max(1, total)).toFixed(4)}%`;
}

/** A block's rect as page-relative percentages — scale-free: zoom never changes these. */
export function pctRect(
  b: { x: number; y: number; width: number; height: number },
  pageW: number,
  pageH: number,
): Pick<CSSProperties, 'left' | 'top' | 'width' | 'height'> {
  return { left: pct(b.x, pageW), top: pct(b.y, pageH), width: pct(b.width, pageW), height: pct(b.height, pageH) };
}

/** A length in PDF points rendered through the `--scale-factor` CSS variable. */
export function scaledPx(pt: number): string {
  return `calc(${pt}px * var(--scale-factor))`;
}

/** A hairline that scales with zoom but never disappears below `minPx`. */
export function scaledHairline(pt: number, minPx = 0.5): string {
  return `max(${minPx}px, calc(${pt}px * var(--scale-factor)))`;
}

/** Set the pdf.js-contract scale variable on the page container (imperative form). */
export function setScaleFactor(el: HTMLElement, scale: number): void {
  el.style.setProperty('--scale-factor', String(scale));
}

/** pdf.js width correction: scaleX factor that makes a DOM text run occupy exactly the
 * PDF-specified width despite screen-font metric mismatch. */
export function widthCorrectionScaleX(pdfWidthPx: number, measuredWidthPx: number): number {
  return measuredWidthPx > 0 ? pdfWidthPx / measuredWidthPx : 1;
}

/** DPR rule: back a canvas with devicePixelRatio-scaled pixels while CSS-sizing it to the
 * viewport ({ canvas.width = vw*dpr, canvas.style.width = vw px }). */
export function dprCanvasSize(viewW: number, viewH: number, dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) {
  return { pixelW: Math.ceil(viewW * dpr), pixelH: Math.ceil(viewH * dpr), cssW: `${viewW}px`, cssH: `${viewH}px` };
}
