// T1 (Reference Playbook) — text reconstruction engine: a TypeScript port of pdfplumber's
// WordExtractor pipeline (pdfplumber/utils/text.py), operating on normalized text units.
// Fixes fragmentation: raw runs → lines → words/segments → paragraph blocks, in LOGICAL order
// (the RTL sort already yields logical order for Hebrew — never reverse strings here; bidi
// reordering happens only at render/export time via src/engine/bidi.ts).
//
// Proven defaults (pdfplumber): Y_TOLERANCE = 3, X_TOLERANCE = 3 (points), with optional
// ratio-based tolerances (`ratio × unit.size`) for mixed heading/body pages.

export interface ReconUnit {
  text: string;
  x0: number; // left, PDF points
  x1: number; // right
  top: number; // top-left origin, y-down
  bottom: number;
  size: number; // font size (hypot of the text matrix's scale column)
  fontName?: string;
}

export interface ReconLine<T extends ReconUnit = ReconUnit> {
  units: T[]; // in LOGICAL reading order
  text: string;
  rtl: boolean;
  x0: number; x1: number; top: number; bottom: number; size: number;
}

export const Y_TOLERANCE = 3;
export const X_TOLERANCE = 3;

const HEBREW = /[֐-׿]/;

/** Direction of a line: RTL when the majority of its letters are in the Hebrew block. */
export function isRtlText(s: string): boolean {
  let he = 0, lat = 0;
  for (const ch of s) { if (HEBREW.test(ch)) he++; else if (/[A-Za-z]/.test(ch)) lat++; }
  return he >= lat && he > 0;
}

/**
 * pdfplumber `cluster_objects` (1-D clustering): sort by key ascending; a value starts a new
 * cluster when it exceeds the PREVIOUS value by more than `tolerance`. Shared with T2 (edge
 * snapping / word alignment) — this exact clusterer is used all over pdfplumber.
 */
export function cluster1d<T>(items: T[], key: (t: T) => number, tolerance: number): T[][] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const clusters: T[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = key(sorted[i - 1]);
    if (key(sorted[i]) > prev + tolerance) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }
  return clusters;
}

/** Sort a line's units into LOGICAL reading order: LTR ascending x0; RTL descending x1
 * (pdfplumber negates coordinates for RTL — identical outcome). */
export function sortLineLogical<T extends ReconUnit>(units: T[], rtl: boolean): T[] {
  return [...units].sort((a, b) => (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
}

/**
 * pdfplumber `char_begins_new_word`, verbatim logic on direction-normalized coordinates:
 * a unit begins a new segment when it jumps backwards, leaves a gap larger than the
 * x-tolerance after the previous unit's end, or sits on a different baseline.
 * Intraline distance is measured END of prev → START of curr; interline is TOP → TOP.
 */
export function beginsNewSegment(
  prev: ReconUnit, curr: ReconUnit, rtl: boolean,
  xTolerance = X_TOLERANCE, yTolerance = Y_TOLERANCE,
): boolean {
  // direction-normalized: for RTL use negated x (ax = -prev.x1, bx = -prev.x0, cx = -curr.x1)
  const ax = rtl ? -prev.x1 : prev.x0;
  const bx = rtl ? -prev.x0 : prev.x1;
  const cx = rtl ? -curr.x1 : curr.x0;
  return (
    cx < ax ||                              // jumped backwards → new segment
    cx > bx + xTolerance ||                 // gap after prev end exceeds tolerance
    Math.abs(curr.top - prev.top) > yTolerance // different baseline → different line
  );
}

export interface ReconOptions {
  /** absolute y tolerance in points (default 3). */
  yTolerance?: number;
  /** when set, per-pair tolerance = ratio × unit.size (pdfplumber y_tolerance_ratio). */
  yToleranceRatio?: number;
  /** absolute x tolerance in points (default 3). */
  xTolerance?: number;
  /** when set, per-pair tolerance = ratio × prev.size (pdfplumber x_tolerance_ratio; ≈0.3). */
  xToleranceRatio?: number;
  /** internal gap that splits a physical line into COLUMN segments (default 2.5 × size). */
  columnGapRatio?: number;
}

/**
 * Steps 3–5 of the playbook pipeline: cluster units into physical lines by `top`
 * (1-D clustering), sort each line logically, split at COLUMN gaps (> columnGapRatio × size),
 * and join each fragment's words with single spaces (word breaks per beginsNewSegment).
 * Returns line fragments in logical order — the input to paragraph building.
 */
export function reconstructLines<T extends ReconUnit>(units: T[], opts: ReconOptions = {}): ReconLine<T>[] {
  const usable = units.filter((u) => u.text.trim());
  if (!usable.length) return [];
  const yTolOf = (u: ReconUnit) => opts.yToleranceRatio != null ? opts.yToleranceRatio * u.size : (opts.yTolerance ?? Y_TOLERANCE);
  const xTolOf = (u: ReconUnit) => opts.xToleranceRatio != null ? opts.xToleranceRatio * u.size : (opts.xTolerance ?? X_TOLERANCE);
  const colGapOf = (u: ReconUnit) => (opts.columnGapRatio ?? 2.5) * Math.max(4, u.size);

  // step 3 — cluster into physical lines by top (tolerance is evaluated per unit pair)
  const sorted = [...usable].sort((a, b) => a.top - b.top);
  const lineClusters: T[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].top > prev.top + Math.min(yTolOf(prev), yTolOf(sorted[i]))) lineClusters.push([sorted[i]]);
    else lineClusters[lineClusters.length - 1].push(sorted[i]);
  }

  const lines: ReconLine<T>[] = [];
  for (const cluster of lineClusters) {
    // step 4 — logical order within the line
    const rtl = isRtlText(cluster.map((u) => u.text).join(' '));
    const ordered = sortLineLogical(cluster, rtl);
    // column split (step 6 prelude): an internal gap > 2.5×size separates column segments
    const fragments: T[][] = [[ordered[0]]];
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1], curr = ordered[i];
      const gap = rtl ? prev.x0 - curr.x1 : curr.x0 - prev.x1;
      if (gap > colGapOf(prev)) fragments.push([curr]);
      else fragments[fragments.length - 1].push(curr);
    }
    for (const frag of fragments) {
      // step 5 — words: join with a space at each new segment (beginsNewSegment); adjacent
      // continuations (kerning splits) join WITHOUT a space.
      let text = frag[0].text;
      for (let i = 1; i < frag.length; i++) {
        const sep = beginsNewSegment(frag[i - 1], frag[i], rtl, xTolOf(frag[i - 1]), yTolOf(frag[i - 1])) ? ' ' : '';
        text += sep + frag[i].text;
      }
      lines.push({
        units: frag,
        text: text.replace(/\s+/g, ' ').trim(),
        rtl,
        x0: Math.min(...frag.map((u) => u.x0)),
        x1: Math.max(...frag.map((u) => u.x1)),
        top: Math.min(...frag.map((u) => u.top)),
        bottom: Math.max(...frag.map((u) => u.bottom)),
        size: Math.max(...frag.map((u) => u.size)),
      });
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

export interface ReconBlock<T extends ReconUnit = ReconUnit> {
  lines: ReconLine<T>[];
  text: string; // logical order, '\n' between lines
  rtl: boolean;
  x0: number; x1: number; top: number; bottom: number; size: number;
  /** measured leading (top-to-top of consecutive lines) / size — the source line height. */
  lineHeightRatio?: number;
}

export interface BlockOptions {
  /** vertical gap between line tops ≤ this × size merges lines into a paragraph (default 1.35). */
  paragraphGapRatio?: number;
  /** minimum horizontal span overlap fraction to merge (default 0.5). */
  minXOverlap?: number;
  /** style guard: font-size ratio above this never merges (heading vs body). */
  maxSizeRatio?: number;
  /** TABLE guard (our adaptation, on top of pdfplumber): a line that shares its y-band with
   * another x-disjoint line is a table ROW — it never paragraph-merges (default true). */
  rowSiblingGuard?: boolean;
}

/**
 * Step 6 — lines → paragraph blocks. Merge consecutive lines when the vertical gap is small
 * (≤ paragraphGapRatio × size, measured top→top), the horizontal spans overlap ≥ minXOverlap,
 * and the style matches. A larger gap, an x-range shift, or a style change starts a new block.
 */
export function linesToBlocks<T extends ReconUnit>(lines: ReconLine<T>[], opts: BlockOptions = {}): ReconBlock<T>[] {
  const gapRatio = opts.paragraphGapRatio ?? 1.35;
  const minOv = opts.minXOverlap ?? 0.5;
  const maxSize = opts.maxSizeRatio ?? 1.15;
  const guard = opts.rowSiblingGuard ?? true;

  const hasRowSibling = (i: number) => lines.some((o, j) => j !== i
    && Math.abs(o.top - lines[i].top) < Math.min(o.size, lines[i].size) * 0.5
    && (Math.max(o.x0, lines[i].x0) - Math.min(o.x1, lines[i].x1)) > 0);

  // union-find over lines
  const par = lines.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < lines.length; i++) {
    if (guard && hasRowSibling(i)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (guard && hasRowSibling(j)) continue;
      const a = lines[i], b = lines[j];
      if (Math.max(a.size, b.size) / Math.min(a.size, b.size) > maxSize) continue; // style change
      const vgap = b.top - a.top; // top→top (bottoms of successive lines often overlap — never compare bottoms)
      if (vgap <= 0 || vgap > gapRatio * Math.min(a.size, b.size) + (a.bottom - a.top) * 0.15) continue;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (overlap < Math.min(a.x1 - a.x0, b.x1 - b.x0) * minOv) continue; // x-range shift
      par[find(i)] = find(j);
    }
  }
  const groups = new Map<number, ReconLine<T>[]>();
  lines.forEach((l, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(l); });

  const blocks: ReconBlock<T>[] = [];
  for (const grp of groups.values()) {
    grp.sort((a, b) => a.top - b.top);
    const text = grp.map((l) => l.text).join('\n');
    const size = Math.max(...grp.map((l) => l.size));
    blocks.push({
      lines: grp,
      text,
      rtl: isRtlText(text),
      x0: Math.min(...grp.map((l) => l.x0)),
      x1: Math.max(...grp.map((l) => l.x1)),
      top: Math.min(...grp.map((l) => l.top)),
      bottom: Math.max(...grp.map((l) => l.bottom)),
      size,
      lineHeightRatio: grp.length > 1 ? Math.min(1.8, Math.max(1.05, Math.round(((grp[1].top - grp[0].top) / Math.max(1, size)) * 100) / 100)) : undefined,
    });
  }
  return blocks.sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

/** Full pipeline: units → lines → paragraph blocks (LOGICAL order throughout). */
export function reconstruct<T extends ReconUnit>(units: T[], opts: ReconOptions & BlockOptions = {}): ReconBlock<T>[] {
  return linesToBlocks(reconstructLines(units, opts), opts);
}
