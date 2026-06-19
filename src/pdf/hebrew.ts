// Hebrew/bidi handling for pdf-lib export.
// pdf-lib does NO bidi/shaping: it draws glyphs in the byte order given. So we must
// reorder a LOGICAL-order string into VISUAL order before drawing, and mirror
// direction-sensitive characters (brackets, quotes). DOM rendering does this itself;
// this utility exists for the pdf-lib draw step only.
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

const HEB = /[֐-׿]/;
const LTR = /[A-Za-z0-9]/;
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);

/**
 * Strict UBA resolves brackets in a pure-RTL run to RTL → mirrored. For our content,
 * parens almost always wrap an LTR code/unit like "(EV6)" / "(WLTP)" and must stay
 * upright. Force bracket PAIRS whose interior is LTR-only (no Hebrew) to the LTR level,
 * so they are neither mirrored nor reordered. Brackets around Hebrew are left untouched.
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
 * Convert a logical-order string to visual order for left-to-right glyph drawing.
 * Digits and Latin runs inside Hebrew keep their natural order (handled by bidi levels).
 */
export function logicalToVisual(input: string, baseDir: 'rtl' | 'ltr' = 'rtl'): string {
  const levels = bidi.getEmbeddingLevels(input, baseDir);
  forceLtrBracketsLevel(input, levels.levels);

  // UTF-16 code units (bidi-js indexes by code unit; our text is BMP-only).
  const chars = input.split('');

  // 1) mirror direction-sensitive characters on RTL levels: ( ) [ ] " etc.
  const mirrored = bidi.getMirroredCharactersMap(input, levels);
  mirrored.forEach((ch: string, idx: number) => { chars[idx] = ch; });

  // 2) reverse each reorder segment (end inclusive).
  const segments = bidi.getReorderSegments(input, levels);
  for (const [start, end] of segments) {
    const slice = chars.slice(start, end + 1).reverse();
    for (let i = 0; i < slice.length; i++) chars[start + i] = slice[i];
  }

  return chars.join('');
}
