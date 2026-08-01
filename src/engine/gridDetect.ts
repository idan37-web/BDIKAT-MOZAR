// T2 (Reference Playbook) — table detection, ported from pdfplumber table.py.
// Strategy A "lines": vector edges → snap → join → intersections → smallest cells → tables.
// Strategy B "text": alignment-derived edges from word positions, then the same steps.
// (Named gridDetect to keep it distinct from templates/tableDetect.ts, which owns the
// product-level RTL label→value reconstruction and calls into this module first.)
import { cluster1d, type ReconUnit } from './textRecon';

export const SNAP_TOLERANCE = 3;
export const JOIN_TOLERANCE = 3;
export const INTERSECTION_TOLERANCE = 1;
export const MIN_WORDS_VERTICAL = 3;

export interface Edge { x0: number; x1: number; top: number; bottom: number; orientation: 'h' | 'v'; }
export interface Point { x: number; top: number; }

/** Snap parallel edges whose positions differ ≤ tolerance: cluster v-edges by x, h-edges by top
 * (the T1 1-D clusterer), and move each cluster to its average position. */
export function snapEdges(edges: Edge[], tolerance = SNAP_TOLERANCE): Edge[] {
  const out: Edge[] = [];
  for (const orientation of ['v', 'h'] as const) {
    const of = edges.filter((e) => e.orientation === orientation);
    const clusters = cluster1d(of, (e) => (orientation === 'v' ? e.x0 : e.top), tolerance);
    for (const cl of clusters) {
      const avg = cl.reduce((s, e) => s + (orientation === 'v' ? e.x0 : e.top), 0) / cl.length;
      for (const e of cl) out.push(orientation === 'v' ? { ...e, x0: avg, x1: avg } : { ...e, top: avg, bottom: avg });
    }
  }
  return out;
}

/** Join collinear edges whose endpoints are within JOIN_TOLERANCE into continuous lines. */
export function joinEdges(edges: Edge[], tolerance = JOIN_TOLERANCE): Edge[] {
  const out: Edge[] = [];
  for (const orientation of ['v', 'h'] as const) {
    const groups = new Map<number, Edge[]>();
    for (const e of edges.filter((x) => x.orientation === orientation)) {
      const key = Math.round(orientation === 'v' ? e.x0 : e.top);
      (groups.get(key) || groups.set(key, []).get(key)!).push(e);
    }
    for (const grp of groups.values()) {
      const lo = (e: Edge) => (orientation === 'v' ? e.top : e.x0);
      const hi = (e: Edge) => (orientation === 'v' ? e.bottom : e.x1);
      grp.sort((a, b) => lo(a) - lo(b));
      let cur = { ...grp[0] };
      for (let i = 1; i < grp.length; i++) {
        const e = grp[i];
        if (lo(e) <= hi(cur) + tolerance) {
          if (orientation === 'v') cur.bottom = Math.max(cur.bottom, e.bottom);
          else cur.x1 = Math.max(cur.x1, e.x1);
        } else { out.push(cur); cur = { ...e }; }
      }
      out.push(cur);
    }
  }
  return out;
}

interface Intersection { v: Edge[]; h: Edge[]; }

/** v×h intersections with tolerance 1 (pdfplumber's exact condition). */
export function findIntersections(edges: Edge[], t = INTERSECTION_TOLERANCE): Map<string, Intersection> {
  const vs = edges.filter((e) => e.orientation === 'v');
  const hs = edges.filter((e) => e.orientation === 'h');
  const pts = new Map<string, Intersection>();
  for (const v of vs) for (const h of hs) {
    if (v.top <= h.top + t && v.bottom >= h.top - t && v.x0 >= h.x0 - t && v.x0 <= h.x1 + t) {
      const key = `${Math.round(v.x0 * 2)}|${Math.round(h.top * 2)}`;
      const it = pts.get(key) || { v: [], h: [] };
      if (!it.v.includes(v)) it.v.push(v);
      if (!it.h.includes(h)) it.h.push(h);
      pts.set(key, it);
    }
  }
  return pts;
}

export interface CellRect { x0: number; top: number; x1: number; bottom: number; }

/** pdfplumber `intersections_to_cells`: for each point, the smallest rectangle whose four
 * corners exist and are edge-connected both ways. */
export function intersectionsToCells(pts: Map<string, Intersection>): CellRect[] {
  const parse = (k: string) => { const [a, b] = k.split('|').map(Number); return { x: a / 2, top: b / 2 }; };
  const keys = [...pts.keys()];
  const points = keys.map(parse);
  const byPos = new Map(keys.map((k, i) => [`${points[i].x}|${points[i].top}`, k]));
  const at = (x: number, top: number) => byPos.get(`${x}|${top}`);
  const sharesEdge = (a: string, b: string, orientation: 'h' | 'v') => {
    const ia = pts.get(a)!, ib = pts.get(b)!;
    const ea = orientation === 'h' ? ia.h : ia.v;
    const eb = orientation === 'h' ? ib.h : ib.v;
    return ea.some((e) => eb.includes(e));
  };
  const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
  const tops = [...new Set(points.map((p) => p.top))].sort((a, b) => a - b);
  const cells: CellRect[] = [];
  for (const p of points) {
    const k = at(p.x, p.top)!;
    // nearest existing point directly right / below, edge-connected to p
    const rightXs = xs.filter((x) => x > p.x);
    const belowTops = tops.filter((t2) => t2 > p.top);
    let done = false;
    for (const bt of belowTops) {
      if (done) break;
      const kBelow = at(p.x, bt);
      if (!kBelow || !sharesEdge(k, kBelow, 'v')) continue;
      for (const rx of rightXs) {
        const kRight = at(rx, p.top);
        if (!kRight || !sharesEdge(k, kRight, 'h')) continue;
        const kDiag = at(rx, bt);
        if (kDiag && sharesEdge(kRight, kDiag, 'v') && sharesEdge(kBelow, kDiag, 'h')) {
          cells.push({ x0: p.x, top: p.top, x1: rx, bottom: bt });
          done = true;
        }
        break; // only the NEAREST edge-connected right corner is tried per row
      }
      break; // only the NEAREST edge-connected below corner is tried
    }
  }
  return cells;
}

export interface GridTable {
  x0: number; top: number; x1: number; bottom: number;
  rows: number[]; // sorted unique cell tops (+ final bottom)
  cols: number[]; // sorted unique cell lefts (+ final right)
  cells: CellRect[];
}

/** Group contiguous (corner-sharing) cells into tables; derive the row/col grid. */
export function cellsToTables(cells: CellRect[]): GridTable[] {
  if (!cells.length) return [];
  const par = cells.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const cornersOf = (c: CellRect) => [`${c.x0}|${c.top}`, `${c.x1}|${c.top}`, `${c.x0}|${c.bottom}`, `${c.x1}|${c.bottom}`];
  const cornerMap = new Map<string, number[]>();
  cells.forEach((c, i) => cornersOf(c).forEach((k) => (cornerMap.get(k) || cornerMap.set(k, []).get(k)!).push(i)));
  for (const idxs of cornerMap.values()) for (let i = 1; i < idxs.length; i++) par[find(idxs[0])] = find(idxs[i]);
  const groups = new Map<number, CellRect[]>();
  cells.forEach((c, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(c); });
  const tables: GridTable[] = [];
  for (const grp of groups.values()) {
    const rows = [...new Set(grp.flatMap((c) => [c.top, c.bottom]))].sort((a, b) => a - b);
    const cols = [...new Set(grp.flatMap((c) => [c.x0, c.x1]))].sort((a, b) => a - b);
    tables.push({
      x0: cols[0], x1: cols[cols.length - 1], top: rows[0], bottom: rows[rows.length - 1],
      rows, cols, cells: grp,
    });
  }
  return tables.sort((a, b) => b.cells.length - a.cells.length);
}

/** Strategy A end-to-end: raw edges → snapped/joined → intersections → cells → tables. */
export function detectGridTables(rawEdges: Edge[]): GridTable[] {
  if (rawEdges.length < 4) return [];
  const edges = joinEdges(snapEdges(rawEdges));
  return cellsToTables(intersectionsToCells(findIntersections(edges)));
}

/**
 * Strategy B "text" (borderless): derive edges from word ALIGNMENT — cluster words by x0, x1,
 * and center (tolerance 1), keep clusters with ≥ MIN_WORDS_VERTICAL words, drop overlapping
 * clusters, and emit v-edges plus row h-edges from word tops. The result feeds the SAME
 * grid pipeline as Strategy A.
 */
export function textStrategyEdges(words: ReconUnit[], minWordsVertical = MIN_WORDS_VERTICAL): Edge[] {
  if (words.length < minWordsVertical * 2) return [];
  const candidates: { x: number; words: ReconUnit[] }[] = [];
  for (const key of ['x0', 'x1', 'center'] as const) {
    const val = (w: ReconUnit) => (key === 'x0' ? w.x0 : key === 'x1' ? w.x1 : (w.x0 + w.x1) / 2);
    for (const cl of cluster1d(words, val, 1)) {
      if (cl.length >= minWordsVertical) candidates.push({ x: cl.reduce((s, w) => s + val(w), 0) / cl.length, words: cl });
    }
  }
  // drop overlapping candidates the pdfplumber way: greedily keep the largest clusters, skipping
  // any cluster that SHARES A WORD with an already-kept one (each word backs at most one edge).
  candidates.sort((a, b) => b.words.length - a.words.length);
  const kept: typeof candidates = [];
  const taken = new Set<ReconUnit>();
  for (const c of candidates) {
    if (c.words.some((w) => taken.has(w))) continue;
    kept.push(c);
    c.words.forEach((w) => taken.add(w));
  }
  if (kept.length < 2) return [];
  const tableWords = [...new Set(kept.flatMap((k) => k.words))];
  const x0 = Math.min(...tableWords.map((w) => w.x0));
  const x1 = Math.max(...tableWords.map((w) => w.x1));
  const top = Math.min(...tableWords.map((w) => w.top));
  const bottom = Math.max(...tableWords.map((w) => w.bottom));
  const edges: Edge[] = kept.map((k) => ({ x0: k.x, x1: k.x, top, bottom, orientation: 'v' as const }));
  edges.push({ x0: x1, x1, top, bottom, orientation: 'v' }); // rightmost boundary
  // horizontal edges: one at each row's top AND bottom, spanning the table's x-range
  for (const row of cluster1d(tableWords, (w) => w.top, 1)) {
    const rTop = Math.min(...row.map((w) => w.top));
    const rBot = Math.max(...row.map((w) => w.bottom));
    edges.push({ x0, x1, top: rTop, bottom: rTop, orientation: 'h' });
    edges.push({ x0, x1, top: rBot, bottom: rBot, orientation: 'h' });
  }
  return edges;
}

/** Assign words to grid cells by CENTER containment; join a cell's words logically (RTL: by
 * descending x within the cell — single-row cells, so line logic degenerates to x order). */
export function gridCellText(table: GridTable, words: ReconUnit[], rtl: boolean): string[][] {
  const rows = table.rows.length - 1;
  const cols = table.cols.length - 1;
  const grid: ReconUnit[][][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
  for (const w of words) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.top + w.bottom) / 2;
    if (cx < table.x0 || cx > table.x1 || cy < table.top || cy > table.bottom) continue;
    const r = table.rows.findIndex((t, i) => i < rows && cy >= t && cy < table.rows[i + 1]);
    const c = table.cols.findIndex((x, i) => i < cols && cx >= x && cx < table.cols[i + 1]);
    if (r >= 0 && c >= 0) grid[r][c].push(w);
  }
  return grid.map((row) => row.map((cellWords) => {
    cellWords.sort((a, b) => a.top - b.top || (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
    return cellWords.map((w) => w.text.trim()).filter(Boolean).join(' ');
  }));
}
