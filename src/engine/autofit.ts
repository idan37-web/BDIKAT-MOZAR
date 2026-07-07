// T6 (Reference Playbook) — auto-fit into fixed slots: binary-search the largest font size
// (10 iterations, then a final overflow-guarantee pass) where the LOGICALLY-wrapped text fits
// the box height AND every wrapped line's VISUAL form fits the box width. Wrapping happens in
// logical order; conversion to visual order (T4 bidi) happens per line only for measurement
// and at draw time.
import { toVisualLine } from './bidi';

export type MeasureFn = (text: string, fontSize: number) => number;
export type WrapFn = (text: string, maxWidth: number, fontSize: number, measure: MeasureFn) => string[];

export interface FitTextResult {
  size: number;
  lines: string[]; // logical order
  /** true when even `min` cannot fit — caller must flag, never silently clip. */
  overflow: boolean;
}

export function fitText(
  text: string,
  box: { w: number; h: number },
  measure: MeasureFn,
  wrap: WrapFn,
  min = 6,
  max = 24,
  lineHeight = 1.35,
): FitTextResult {
  const fits = (size: number, lines: string[]): boolean =>
    lines.length * size * lineHeight <= box.h + 0.5 &&
    lines.every((l) => measure(toVisualLine(l), size) <= box.w + 0.5);

  let lo = min, hi = max, best = min;
  for (let i = 0; i < 10; i++) {
    const size = (lo + hi) / 2;
    const lines = wrap(text, box.w, size, measure);
    if (fits(size, lines)) { best = size; lo = size; } else { hi = size; }
  }
  // round DOWN (rounding up would break the fit guarantee), then one final
  // overflow-guarantee pass at the size actually returned.
  const size = Math.max(min, Math.floor(best * 10) / 10);
  const lines = wrap(text, box.w, size, measure);
  const overflow = !fits(size, lines);
  return { size, lines, overflow };
}
