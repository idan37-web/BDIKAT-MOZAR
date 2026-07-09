// Browser-side single-line fit for the print view. Mirrors the pdf-lib exporter's contract
// (planTextLines + advance squeeze): a one-line box first shrinks its font toward a 0.72 floor,
// and if the line is STILL wider than the box, squeezes it horizontally (scaleX) so nothing is
// clipped — the browser's own metrics are the measurer here, not canvas.
//
// KEPT AS A RAW JS STRING on purpose: Playwright's page.evaluate(fn) serializes the TRANSPILED
// function source, and esbuild/tsx wraps it with a __name() helper that doesn't exist inside the
// page (ReferenceError). A plain string evaluates cleanly in both Chromium print export and the
// in-app route (via the Function wrapper below) — one source, two consumers.
export const PRINT_FIT_PASS_SRC = `
(() => {
  const els = document.querySelectorAll('[data-fitline]');
  els.forEach((el) => {
    const inner = el.querySelector('[data-m]');
    if (!inner) return;
    // sub-pixel measurement: getBoundingClientRect is fractional (scrollWidth is integer-rounded
    // and misses <1px overflows that still poke a glyph past the box in print). For a rotated
    // block, rects rotate too — measure the UNROTATED content width via the inner span's
    // scroll metrics fallback when a transform is present on the container.
    const rot = el.style.transform && el.style.transform.indexOf('rotate') >= 0;
    const boxW = rot ? el.clientWidth : el.getBoundingClientRect().width;
    const contentW = () => rot ? inner.scrollWidth : inner.getBoundingClientRect().width;
    if (!boxW) return;
    const over = () => contentW() - boxW > 0.25;
    if (!over()) return;
    const basePx = parseFloat(getComputedStyle(el).fontSize) || 12;
    let px = basePx;
    const floor = basePx * 0.72;
    while (px > floor && over()) {
      px = Math.max(floor, px - 0.25);
      el.style.fontSize = px + 'px';
    }
    if (over()) {
      inner.style.transform = 'scaleX(' + (boxW / contentW()) + ')';
      inner.style.transformOrigin = el.dataset.anchor === 'left' ? '0 50%' : '100% 50%';
    }
  });
})();
`;

/** In-app runner for the same source (the print route calls this after fonts are ready). */
export function printFitPass(): void {
  new Function(PRINT_FIT_PASS_SRC)();
}
