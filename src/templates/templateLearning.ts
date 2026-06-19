// Stage 6 (C.8): REAL template learning — no simulation. Takes one or more already
// imported DocumentIRs of the same brand/family and derives an editable TemplateSpec:
// repeated page roles + slots, with fixed-vs-dynamic decided from real cross-document
// evidence (same-family catalogs share a skeleton; the per-model values differ).
//
// Built entirely on the IR (the source of truth) — never on the page raster.
import type { BBox, DocumentIR, PageIR, TextBlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock } from '../types/catalog';
import {
  detectFormat,
  type PageRole,
  type SlotKind,
  type SlotSpec,
  type SlotStyle,
  type TemplatePageSpec,
  type TemplateSpec,
} from './templateSpec';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function union(boxes: BBox[]): BBox {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function iou(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.width * a.height + b.width * b.height - inter;
  return uni <= 0 ? 0 : inter / uni;
}

/** Gap between two boxes on each axis (0 when they overlap on that axis). */
function gaps(a: BBox, b: BBox): { dx: number; dy: number } {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return { dx, dy };
}

// ---------------------------------------------------------------------------
// Regions: merge per-line text runs into logical blocks (paragraphs / tables)
// ---------------------------------------------------------------------------
export interface Region {
  blockType: 'text' | 'image';
  bbox: BBox;
  /** Concatenated LOGICAL text (text regions only). */
  text: string;
  count: number;
  maxFont: number;
  medFont: number;
  weight: number;
  color: string;
  align: TextBlockIR['align'];
  direction: TextBlockIR['direction'];
  fontFamily: string;
  /** image regions only. */
  src?: string;
}

function median(ns: number[]): number {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mode<T>(items: T[]): T {
  const m = new Map<T, number>();
  let best = items[0];
  let bc = 0;
  for (const it of items) {
    const c = (m.get(it) || 0) + 1;
    m.set(it, c);
    if (c > bc) { bc = c; best = it; }
  }
  return best;
}

/** Order a region's runs into reading order and join (RTL: right→left, top→bottom). */
function regionText(blocks: TextBlockIR[], rtl: boolean): string {
  const sorted = [...blocks].sort((a, b) => a.y - b.y || (rtl ? b.x - a.x : a.x - b.x));
  let out = '';
  let prevY = -Infinity;
  let prevFont = sorted[0]?.fontSize || 10;
  for (const b of sorted) {
    if (b.y - prevY > prevFont * 0.8 && out) out += '\n';
    else if (out) out += ' ';
    out += b.text.trim();
    prevY = b.y;
    prevFont = b.fontSize;
  }
  return out.trim();
}

/**
 * Cluster a page's text runs into regions. Two runs join when their boxes are
 * within ~1 line vertically and ~1 glyph horizontally AND have a comparable font
 * size — so a heading never merges into body copy, but a whole spec grid (cells
 * chained neighbour-to-neighbour) collapses into a single region.
 */
export function groupRegions(page: PageIR): Region[] {
  const texts = page.blocks.filter(isTextBlock);
  const images = page.blocks.filter(isImageBlock);

  // union-find over text runs
  const parent = texts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => { parent[find(i)] = find(j); };

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const fa = a.fontSize || 10;
      const fb = b.fontSize || 10;
      const ratio = Math.max(fa, fb) / Math.min(fa, fb);
      if (ratio > 1.7) continue; // different typographic level
      const { dx, dy } = gaps(a, b);
      const f = Math.max(fa, fb);
      if (dy <= f * 0.9 && dx <= f * 1.4) join(i, j);
    }
  }

  const clusters = new Map<number, TextBlockIR[]>();
  texts.forEach((b, i) => {
    const r = find(i);
    (clusters.get(r) || clusters.set(r, []).get(r)!).push(b);
  });

  const regions: Region[] = [];
  for (const group of clusters.values()) {
    const rtl = mode(group.map((g) => g.direction)) !== 'ltr';
    const boxes = group.map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.height }));
    regions.push({
      blockType: 'text',
      bbox: union(boxes),
      text: regionText(group, rtl),
      count: group.length,
      maxFont: Math.max(...group.map((g) => g.fontSize)),
      medFont: median(group.map((g) => g.fontSize)),
      weight: median(group.map((g) => g.fontWeight)) >= 600 ? 700 : 400,
      color: mode(group.map((g) => g.color)),
      align: mode(group.map((g) => g.align)),
      direction: rtl ? 'rtl' : 'ltr',
      fontFamily: mode(group.map((g) => g.fontFamily)),
    });
  }

  for (const img of images) {
    regions.push({
      blockType: 'image',
      bbox: { x: img.x, y: img.y, width: img.width, height: img.height },
      text: '',
      count: 1,
      maxFont: 0,
      medFont: 0,
      weight: 400,
      color: '#000000',
      align: 'start',
      direction: 'ltr',
      fontFamily: '',
      src: img.src,
    });
  }
  return regions;
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------
const KW = {
  colors: /צבע|בחר את הצבע|ריפוד/,
  wheels: /חישוק|ג['׳]?נט|גלגל/,
  safety: /בטיחות|כריות אוויר|מערכת סיוע|בלימה/,
  pollution: /זיהום|דרגת זיהום|פליטת|CO2/i,
  price: /מחיר|מחירון|₪/,
  engine: /מנוע|תצרוכת|נפח מנוע|מידות|תיבת הילוכים|הספק/,
  legal: /נתוני היצרן|המידע והנתונים המופיעים|תקן EU|כפוף לתנאי|ט\.?ל\.?ח/,
} as const;

export function classifyPage(
  page: PageIR,
  regions: Region[],
  index: number,
  total: number,
): { role: PageRole; evidence: string[] } {
  const ev: string[] = [];
  const texts = page.blocks.filter(isTextBlock);
  const n = texts.length;
  const small = texts.filter((t) => t.fontSize < 10).length;
  const smallRatio = n ? small / n : 0;
  const allText = texts.map((t) => t.text).join(' ');
  const maxFont = Math.max(0, ...texts.map((t) => t.fontSize));
  const hit = (k: keyof typeof KW) => KW[k].test(allText);

  if (index === 0) {
    ev.push('first page', `maxFont ${maxFont.toFixed(0)}`, `${n} runs`);
    return { role: 'cover', evidence: ev };
  }

  const legalHeavy = hit('legal') || hit('pollution');
  if (index >= total - 1 && legalHeavy) {
    ev.push('last page', 'legal/pollution text');
    return { role: 'back', evidence: ev };
  }

  // dense small-font grid → technical spec table
  if (n >= 40 && smallRatio >= 0.55) {
    ev.push(`dense grid: ${n} runs, ${(smallRatio * 100) | 0}% small-font`, hit('engine') ? 'engine terms' : 'tabular');
    return { role: 'spec', evidence: ev };
  }

  if (legalHeavy && index >= total - 2) {
    ev.push('legal/pollution near end');
    return { role: 'back', evidence: ev };
  }

  if (hit('price')) { ev.push('price terms'); return { role: 'price', evidence: ev }; }

  if (hit('colors') && (hit('wheels') || /בחר את הצבע/.test(allText)) && index >= total - 4) {
    ev.push('colours + wheels selection near end');
    return { role: 'colors', evidence: ev };
  }

  if (hit('safety') && !hit('engine') && /מערכת/.test(allText)) {
    ev.push('safety systems, no spec grid');
    return { role: 'safety', evidence: ev };
  }

  // a marketing spread = a heading + an image region
  const hasImage = regions.some((r) => r.blockType === 'image');
  const hasHeading = regions.some((r) => r.blockType === 'text' && r.maxFont >= maxFont * 0.9 && maxFont >= 20);
  if (hasHeading || hasImage) {
    ev.push(hasImage ? 'hero image + copy' : 'large heading + copy');
    return { role: 'feature', evidence: ev };
  }

  ev.push('default body');
  return { role: 'content', evidence: ev };
}

// ---------------------------------------------------------------------------
// Slot kind inference
// ---------------------------------------------------------------------------
function slotKind(role: PageRole, r: Region, isLargestText: boolean): SlotKind {
  if (r.blockType === 'image') return role === 'cover' || role === 'feature' ? 'hero-image' : 'image';
  if (KW.legal.test(r.text)) return 'legal';
  if (role === 'cover' && isLargestText) return 'model-name';
  if (role === 'spec') return 'spec-table';
  if (role === 'colors') return KW.wheels.test(r.text) && !KW.colors.test(r.text) ? 'wheels' : 'colors';
  if (role === 'safety') return 'safety';
  if (role === 'price') return 'price';
  if (role === 'back') return KW.pollution.test(r.text) ? 'pollution' : 'legal';
  if (isLargestText && r.maxFont >= 18) return 'heading';
  return 'marketing-text';
}

const SLOT_LABEL: Record<SlotKind, string> = {
  'model-name': 'שם הדגם',
  heading: 'כותרת',
  'marketing-text': 'טקסט שיווקי',
  'hero-image': 'תמונת נושא',
  image: 'תמונה',
  'spec-table': 'טבלת מפרט טכני',
  colors: 'צבעים',
  wheels: 'חישוקים',
  safety: 'בטיחות',
  pollution: 'דרגת זיהום',
  price: 'מחיר',
  legal: 'טקסט משפטי',
  logo: 'לוגו',
  background: 'רקע',
  text: 'טקסט',
};

/** Kinds that are inherently fixed brand furniture rather than per-model content. */
const FIXED_KINDS = new Set<SlotKind>(['legal', 'logo', 'background']);

function styleOf(r: Region): SlotStyle | undefined {
  if (r.blockType !== 'text') return undefined;
  return {
    fontFamily: r.fontFamily,
    fontSize: Math.round(r.medFont * 10) / 10,
    fontWeight: r.weight,
    color: r.color,
    align: r.align,
    direction: r.direction,
    lineHeight: 1.2,
  };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Cross-document matching → fixed vs dynamic
// ---------------------------------------------------------------------------
interface MatchedSlot {
  base: Region;
  matches: Region[]; // regions from OTHER docs matched to base (same page index)
}

function matchPageRegions(baseRegions: Region[], otherDocPages: Region[][]): MatchedSlot[] {
  return baseRegions.map((base) => {
    const matches: Region[] = [];
    for (const others of otherDocPages) {
      let best: Region | undefined;
      let bestScore = 0.18; // IoU threshold
      for (const o of others) {
        if (o.blockType !== base.blockType) continue;
        const s = iou(base.bbox, o.bbox);
        if (s > bestScore) { bestScore = s; best = o; }
      }
      if (best) matches.push(best);
    }
    return { base, matches };
  });
}

/** Distinct normalized values seen for one matched region across the docs. */
function distinctCount(ms: MatchedSlot): number {
  const vals = [norm(ms.base.text), ...ms.matches.map((m) => norm(m.text))].filter(Boolean);
  return new Set(vals).size;
}

/** Kinds that carry per-model content (used for the single-doc dynamic fallback). */
const DYNAMIC_KINDS = new Set<SlotKind>([
  'model-name', 'heading', 'marketing-text', 'hero-image', 'image',
  'spec-table', 'colors', 'wheels', 'safety', 'pollution', 'price',
]);

/**
 * Build ONE SlotSpec from a group of matched regions (a group is a single region
 * for narrative pages, or a whole consolidated table/legal block on dense pages).
 */
function buildSlot(
  id: string, key: string, kind: SlotKind, group: MatchedSlot[], modelTokens: string[],
): SlotSpec {
  const bases = group.map((g) => g.base);
  const blockType = bases[0].blockType;
  const bbox = union(bases.map((b) => b.bbox));
  const crossDoc = group.some((g) => g.matches.length >= 1);
  const variants = Math.max(1, ...group.map(distinctCount));
  const joinedText = bases.map((b) => b.text).filter(Boolean).join('\n');

  let dynamic: boolean;
  let confidence: number;
  if (FIXED_KINDS.has(kind)) {
    dynamic = false;
    confidence = crossDoc ? 0.7 : 0.5;
  } else if (crossDoc && blockType === 'text') {
    // real evidence beats the kind heuristic: a region that differs across models is
    // dynamic; one identical across all models is fixed brand boilerplate.
    dynamic = group.some((g) => distinctCount(g) > 1);
    confidence = 0.9;
  } else {
    const bearsModel = modelTokens.some((t) => joinedText.toLowerCase().includes(t));
    dynamic = bearsModel || DYNAMIC_KINDS.has(kind);
    confidence = crossDoc ? 0.6 : 0.45;
  }

  const rep = bases.find((b) => b.text) || bases[0];
  return {
    id, key, kind, blockType, dynamic, bbox,
    style: styleOf(rep),
    label: SLOT_LABEL[kind],
    sample: blockType === 'image' ? rep.src : joinedText.slice(0, 160),
    fixedContent: !dynamic && blockType === 'text' ? joinedText : undefined,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    variants,
    crossDocEvidence: crossDoc,
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export interface LearnOptions {
  family?: string;
  /** Lowercase model token to treat as dynamic when learning from a single doc. */
  modelTokens?: string[];
}

/** Extract the model token from a cover region ("NEW PEUGEOT 3008" → "3008"). */
export function modelTokenFromCover(doc: DocumentIR): string | undefined {
  const cover = doc.pages[0];
  if (!cover) return undefined;
  const regions = groupRegions(cover).filter((r) => r.blockType === 'text');
  if (!regions.length) return undefined;
  const largest = regions.sort((a, b) => b.maxFont - a.maxFont)[0];
  const m = /(?:peugeot|citro[eë]n|opel|ds|mg)\s+(.+)/i.exec(norm(largest.text));
  if (m) return m[1].trim().toLowerCase();
  // fall back: trailing alphanumeric model code
  const m2 = /([a-z]?\d{3,4}|c\d(?:\s+\w+)?)\s*$/i.exec(norm(largest.text));
  return m2 ? m2[1].trim().toLowerCase() : undefined;
}

/**
 * Learn a TemplateSpec from one or more same-family DocumentIRs. With ≥2 docs the
 * fixed/dynamic decision uses real cross-document evidence (matched regions whose
 * text is identical across models are FIXED; regions whose text differs are the
 * per-model DYNAMIC slots). With a single doc it falls back to content heuristics.
 */
export function learnTemplate(docs: DocumentIR[], opts: LearnOptions = {}): TemplateSpec {
  if (!docs.length) throw new Error('learnTemplate: need at least one DocumentIR');

  const brand = docs.find((d) => d.brand && d.brand !== 'unknown')?.brand || docs[0].brand || 'unknown';
  const base = docs[0];
  const format = detectFormat(base.pages[0]?.width || 0, base.pages[0]?.height || 1);
  const family = opts.family || `${brand}-${format}`;
  const modelTokens = opts.modelTokens
    || docs.map(modelTokenFromCover).filter((t): t is string => !!t);

  // pre-group every doc's pages into regions once
  const docRegions = docs.map((d) => d.pages.map((p) => groupRegions(p)));
  const baseRegions = docRegions[0];
  const maxPages = base.pages.length;

  const pages: TemplatePageSpec[] = [];
  for (let pi = 0; pi < maxPages; pi++) {
    const page = base.pages[pi];
    const regions = baseRegions[pi];
    const { role, evidence } = classifyPage(page, regions, pi, maxPages);

    // same-index regions from the OTHER docs (skeleton aligns by index)
    const otherPages = docRegions.slice(1).map((dr) => dr[pi]).filter((r): r is Region[] => !!r);
    const matched = matchPageRegions(regions, otherPages);

    const textMatched = matched.filter((m) => m.base.blockType === 'text' && m.base.text);
    const imageMatched = matched.filter((m) => m.base.blockType === 'image');
    const largestFont = Math.max(0, ...textMatched.map((m) => m.base.maxFont));

    const slots: SlotSpec[] = [];
    let si = 0;
    const push = (kind: SlotKind, group: MatchedSlot[]) => {
      if (!group.length) return;
      slots.push(buildSlot(`${page.id}_s${si}`, `p${pi + 1}.${kind}.${si}`, kind, group, modelTokens));
      si++;
    };

    // Dense, fundamentally-single-region pages collapse to canonical slots; narrative
    // pages keep one slot per region (heading / paragraph / callout). Either way the
    // user can split or merge during review (Stage 6 mandates manual correction).
    if (role === 'spec') {
      const heads = textMatched.filter((m) => /מפרט/.test(m.base.text));
      const body = textMatched.filter((m) => !heads.includes(m));
      push('heading', heads);
      push('spec-table', body);
    } else if (role === 'colors') {
      const wheels = textMatched.filter((m) => KW.wheels.test(m.base.text) && !KW.colors.test(m.base.text));
      const colors = textMatched.filter((m) => !wheels.includes(m));
      push('colors', colors);
      push('wheels', wheels);
    } else if (role === 'back' || role === 'price') {
      const pollution = textMatched.filter((m) => KW.pollution.test(m.base.text));
      const legal = textMatched.filter((m) => !pollution.includes(m));
      push(role === 'price' ? 'price' : 'legal', legal);
      push('pollution', pollution);
    } else {
      for (const m of textMatched) {
        const isLargest = m.base.maxFont === largestFont && largestFont > 0;
        push(slotKind(role, m.base, isLargest), [m]);
      }
    }
    for (const m of imageMatched) push(slotKind(role, m.base, false), [m]);

    // deterministic stack order: by y then x
    slots.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

    pages.push({ index: pi, role, width: page.width, height: page.height, roleEvidence: evidence, slots });
  }

  // tokens: accent is per-model (brief) — flag dynamic if text colour varied
  const allColors = docRegions.flat().flat().filter((r) => r.blockType === 'text').map((r) => r.color);
  const tokens = {
    text: mode(allColors.length ? allColors : ['#111418']),
    accentDynamic: true, // per the brief: brand.accent is a per-model token
    fonts: collectFonts(docRegions),
  };

  return {
    id: `tpl_${brand}_${format}_${Date.now()}`,
    brand,
    family,
    format,
    learnedFrom: docs.map((d) => d.sourcePdfName || d.id),
    tokens,
    pages,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

function collectFonts(docRegions: Region[][][]): Record<string, string> {
  const fonts: Record<string, string> = {};
  for (const r of docRegions.flat().flat()) {
    if (r.blockType === 'text' && r.fontFamily) fonts[r.fontFamily] = r.fontFamily;
  }
  return fonts;
}

/** Convenience: count how many slots ended up dynamic vs fixed (QA / UI summary). */
export function summarizeTemplate(t: TemplateSpec) {
  let dynamic = 0;
  let fixed = 0;
  let crossDoc = 0;
  for (const p of t.pages) for (const s of p.slots) {
    if (s.dynamic) dynamic++; else fixed++;
    if (s.crossDocEvidence) crossDoc++;
  }
  const roles = t.pages.reduce<Record<string, number>>((m, p) => ((m[p.role] = (m[p.role] || 0) + 1), m), {});
  return { pages: t.pages.length, slots: dynamic + fixed, dynamic, fixed, crossDoc, roles };
}

// re-export for consumers that only import the learner
export type { TemplateSpec, SlotSpec } from './templateSpec';
