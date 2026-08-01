// Stage 0 (docs/REBUILD_BRIEF.md §6) — lock the coordinate + bidi seams.
// The brief's Stage-0 acceptance criteria, pinned as permanent unit tests:
//   1. coords round-trips a point PDF→viewport→PDF within <0.5pt.
//   2. bidi reorders `מחיר: 149,900 ₪ (GT)` and digits + the Latin run are NOT reversed.
//
// These assert the EXISTING seams already satisfy the contract (no rename of the
// section-4 data model — that would be a material change per §7a; the IR in
// src/types/catalog.ts already carries the section-4 semantics). The seams live at
// src/editor/coords.ts (the single pt<->px map) and src/engine/bidi.ts (the single
// UAX #9 seam), which src/pdf/hebrew.ts re-exports.
import { describe, it, expect } from 'vitest';
import { ptToPx, pxToPt, blockScreenRect } from '../src/editor/coords';
import { toVisualLine } from '../src/engine/bidi';
import { logicalToVisual } from '../src/pdf/hebrew';

describe('Stage 0 — coords seam round-trips PDF→viewport→PDF (<0.5pt)', () => {
  // A4/Letter-ish extents plus non-integer zoom & DPR-like factors.
  const scales = [0.5, 1, 1.5, 2, 2.7183, 3.14159];
  const points = [0, 12.34, 100, 595.276, 841.89, 1234.5];

  it('pxToPt(ptToPx(v)) returns v within <0.5pt across zoom/DPR factors', () => {
    let maxErr = 0;
    for (const scale of scales) {
      for (const v of points) {
        maxErr = Math.max(maxErr, Math.abs(pxToPt(ptToPx(v, scale), scale) - v));
      }
    }
    expect(maxErr).toBeLessThan(0.5);
    // it is in fact float-exact, well under the 0.5pt tolerance the brief allows.
    expect(maxErr).toBeLessThan(1e-9);
  });

  it('blockScreenRect maps a block back to its PDF-point bbox within <0.5pt', () => {
    const scale = 1.5;
    const b = { x: 42.5, y: 613.2, width: 220.75, height: 18.4 };
    const r = blockScreenRect(b, scale);
    const back = {
      x: pxToPt(r.left, scale), y: pxToPt(r.top, scale),
      width: pxToPt(r.width, scale), height: pxToPt(r.height, scale),
    };
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(back[k] - b[k])).toBeLessThan(0.5);
    }
  });
});

describe('Stage 0 — bidi seam reorders a mixed RTL line without breaking LTR runs', () => {
  const logical = 'מחיר: 149,900 ₪ (GT)';

  it('digits (149,900) and the Latin run (GT) survive visual reordering intact', () => {
    const visual = toVisualLine(logical, 'rtl');
    // the LTR runs keep their own left-to-right order — no naive reversal.
    expect(visual).toContain('149,900');
    expect(visual).not.toContain('009,941'); // the reversed-digits bug we must never regress
    expect(visual).toContain('GT');
    expect(visual).not.toContain('TG');
    // the Hebrew word IS reordered (that is the whole point of the seam).
    expect(visual).not.toContain('מחיר');
    expect([...visual].reverse().join('')).toContain('מחיר');
  });

  it('src/pdf/hebrew.ts re-exports the same seam (one bidi implementation, not two)', () => {
    expect(logicalToVisual(logical, 'rtl')).toBe(toVisualLine(logical, 'rtl'));
  });
});
