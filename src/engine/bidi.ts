// T4 (Reference Playbook) — the ONE bidi seam (UAX #9 via bidi-js, which implements rules
// L1–L2 exactly). The IR stores LOGICAL order; visual reordering happens ONLY here, at draw
// time, per WRAPPED LINE (wrap first in logical order with measured widths, then reorder each
// line slice — rule L1 resets trailing whitespace per line, so reordering a whole paragraph
// and then cutting lines produces wrong edges). Never hand-reverse strings: the L2 loop
// reverses nested level runs; naive reversal is exactly the digits-reversed bug.
import bidiFactory from 'bidi-js';

const bidi = bidiFactory(); // once, module level

const HEB = /[֐-׿]/;
const LTR = /[A-Za-z0-9]/;
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);

/**
 * Refinement over strict UBA (hard-won on real brochures): brackets whose interior is
 * LTR-only (a code/unit like "(WLTP)" / "(EV6)") are forced to the LTR level so they are
 * neither mirrored nor reordered. Brackets around Hebrew are left to the algorithm.
 */
function forceLtrBracketsLevel(input: string, levels: Uint8Array): void {
  const stack: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (OPEN[ch]) stack.push(i);
    else if (CLOSE.has(ch)) {
      const open = stack.pop();
      if (open == null) continue;
      const inner = input.slice(open + 1, i);
      if (LTR.test(inner) && !HEB.test(inner)) {
        const lv = levels[open + 1] ?? levels[open];
        const even = lv % 2 ? lv + 1 : lv; // nearest LTR (even) level
        levels[open] = even;
        levels[i] = even;
      }
    }
  }
}

/**
 * Logical → visual order for ONE wrapped line (left-to-right glyph drawing, e.g. pdf-lib).
 * Digits and Latin runs inside Hebrew keep their natural order (bidi levels), and mirrored
 * characters (brackets/quotes) are swapped where the algorithm requires.
 */
export function toVisualLine(logical: string, baseDir: 'rtl' | 'ltr' = 'rtl'): string {
  const levels = bidi.getEmbeddingLevels(logical, baseDir);
  forceLtrBracketsLevel(logical, levels.levels);

  // UTF-16 code units (bidi-js indexes by code unit; our text is BMP-only).
  const chars = logical.split('');

  // 1) mirror direction-sensitive characters on RTL levels
  const mirrored = bidi.getMirroredCharactersMap(logical, levels);
  mirrored.forEach((ch: string, idx: number) => { chars[idx] = ch; });

  // 2) rule L2: reverse each reorder segment (end inclusive)
  const segments = bidi.getReorderSegments(logical, levels);
  for (const [start, end] of segments) {
    const slice = chars.slice(start, end + 1).reverse();
    for (let i = 0; i < slice.length; i++) chars[start + i] = slice[i];
  }

  return chars.join('');
}
