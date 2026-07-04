// Stage 6 (C.8): REAL template learning — no simulation. Takes one or more already
// imported DocumentIRs of the same brand/family and derives an editable TemplateSpec:
// repeated page roles + slots, with fixed-vs-dynamic decided from real cross-document
// evidence (same-family catalogs share a skeleton; the per-model values differ).
//
// Built entirely on the IR (the source of truth) — never on the page raster.
import type { BBox, DocumentIR, PageIR, TextBlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock } from '../types/catalog';
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
  blockType: 'text' | 'image' | 'shape';
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
  /** shape regions only: fill colour. */
  fill?: string;
}

/** The value used to decide fixed-vs-dynamic for a region (text / image src / shape fill). */
function regionValue(r: Region): string {
  return r.blockType === 'shape' ? (r.fill || '') : r.blockType === 'image' ? (r.src || '') : r.text;
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
  // Sort by LINE (y), then by POSITION within the line: an RTL line reads right→left, so
  // x-descending == logical reading order regardless of whether the generator emitted the
  // stream in logical or visual order (stream order is NOT reliable across generators).
  const lineOf = (b: TextBlockIR) => Math.round(b.y / Math.max(4, b.fontSize * 0.6));
  const sorted = [...blocks].sort((a, b) => lineOf(a) - lineOf(b) || (rtl ? (b.x + b.width) - (a.x + a.width) : a.x - b.x));
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

export type GroupMode = 'para' | 'cell' | 'row';

const HEB_WORD = /[֐-׿]{2,}/; // a Hebrew word = a label / section header
/** A "label" cell holds a Hebrew field name/section header; anything else (number, V, unit,
 * "205/55R16", a trim name) is a "value" that belongs to the row of the label on its reading-right. */
function isLabelCell(t: string): boolean { return HEB_WORD.test(t); }

/**
 * Group a dense table's cells into ROWS. Within each y-band (a visual row), cells are read
 * right→left (RTL); each Hebrew LABEL closes a row consisting of that label plus the value cells
 * to its reading-left, back to the previous label. This keeps two side-by-side tables separate
 * even though they interleave in x (the intra-table label→value gap is larger than the gap
 * between the tables), and collapses ~3N cell boxes into ~N readable row slots.
 */
function clusterTableRows(texts: TextBlockIR[]): Map<number, TextBlockIR[]> {
  const out = new Map<number, TextBlockIR[]>();
  let key = 0;
  const emit = (cells: TextBlockIR[]) => { if (cells.length) out.set(key++, cells); };
  // build y-bands (a run and its same-baseline neighbours)
  const bySorted = [...texts].map((b, i) => ({ b, i })).sort((p, q) => p.b.y - q.b.y);
  const bands: TextBlockIR[][] = [];
  for (const { b } of bySorted) {
    const band = bands.find((bd) => Math.abs(bd[0].y - b.y) < Math.min(bd[0].fontSize || 10, b.fontSize || 10) * 0.6);
    if (band) band.push(b); else bands.push([b]);
  }
  for (const band of bands) {
    // reading order for an RTL row = x DESCENDING (right→left). A Hebrew LABEL OPENS a row and
    // absorbs the value cells to its left (which come next in the walk), back to the following
    // label. Two side-by-side tables interleave in x, but each label keeps only its OWN values
    // (the next table's label starts a fresh row), so the tables stay separate.
    const row = [...band].sort((a, c) => (c.x + c.width) - (a.x + a.width));
    let current: TextBlockIR[] = [];
    for (const cell of row) {
      if (isLabelCell(cell.text)) { if (current.length) emit(current); current = [cell]; }
      else current.push(cell);
    }
    emit(current);
  }
  return out;
}

/**
 * Cluster a page's text runs into regions. Two runs join when their boxes are
 * within ~1 line vertically and ~1 glyph horizontally AND have a comparable font
 * size — so a heading never merges into body copy. Modes: 'para' clusters prose,
 * 'row' groups dense-table cells into rows, 'cell' keeps every positioned cell separate.
 */
export function groupRegions(page: PageIR, grouping: GroupMode = 'para'): Region[] {
  const texts = page.blocks.filter(isTextBlock);
  const images = page.blocks.filter(isImageBlock);

  let clusters: Map<number, TextBlockIR[]>;
  if (grouping === 'row') {
    // DENSE TABLE PAGE: group each row (a label + its value cells) into ONE region instead of one
    // region per cell — so a spec/equipment table reads as ~N rows, not ~3N word-boxes, while two
    // side-by-side tables stay separate (see clusterTableRows).
    clusters = clusterTableRows(texts);
  } else {
    // union-find over text runs (mode 'para' clusters prose/paragraphs; 'cell' keeps each run)
    const parent = texts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (i: number, j: number) => { parent[find(i)] = find(j); };
    if (grouping === 'para') {
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
    }
    clusters = new Map<number, TextBlockIR[]>();
    texts.forEach((b, i) => {
      const r = find(i);
      (clusters.get(r) || clusters.set(r, []).get(r)!).push(b);
    });
  }

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

  for (const sh of page.blocks.filter(isShapeBlock)) {
    regions.push({
      blockType: 'shape',
      bbox: { x: sh.x, y: sh.y, width: sh.width, height: sh.height },
      text: '', count: 1, maxFont: 0, medFont: 0, weight: 400,
      color: sh.fill || '#000000', align: 'start', direction: 'ltr', fontFamily: '',
      fill: sh.fill || '#000000',
    });
  }
  return regions;
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------
const KW = {
  colors: /צבע|גוון|בחר את הצבע|ריפוד|מטאל[יי]|פנינה/,
  wheels: /חישוק|ג['׳]?נט|גלגל|חישוקי סגסוגת/,
  safety: /בטיחות|כריות אוויר|מערכת סיוע|מערכת בקרת|בלימה|ESP|ABS|EBD|זיהוי תמרורים|בקרת שיוט|התרעה/,
  equipment: /אבזור|ציוד|מערכת מולטימדיה|מסך|דיבורית|USB|מושב|בקרת אקלים|תאורה|חיישני חנייה|מצלמ/,
  pollution: /זיהום|דרגת זיהום|פליט|CO2/i,
  price: /מחיר|מחירון|₪/,
  engine: /מנוע|תצרוכת|נפח מנוע|מידות|תיבת הילוכים|הספק|מומנט|בוכנות|שסתומים|בסיס גלגלים|כושר גרירה|משקל עצמי|תאוצה/,
  units: /כ["׳]?ס|סמ["׳]?ק|ק["׳]?ג|ק["׳]?מ|קמ["׳]?ש|מ["׳]?מ|קוט["׳]?ש|נ["׳]?מ|\bhp\b|\bkW\b|\bNm\b/i,
  legal: /נתוני היצרן|המידע והנתונים המופיעים|תקן EU|כפוף לתנאי|ט\.?ל\.?ח|להמחשה בלבד|אחריות/,
} as const;

/** Does this region's OWN text look like a technical-spec block (key/value rows + numbers)? */
function looksLikeSpec(r: Region): boolean {
  const t = r.text;
  if (!t) return false;
  const digits = (t.match(/\d/g) || []).length;
  const units = (t.match(new RegExp(KW.units.source, 'gi')) || []).length; // GLOBAL count (non-global match always returned 1)
  if (units >= 2) return true;
  if (KW.engine.test(t) && digits >= 3) return true;
  // a dense numeric cluster in a small font (a spec column collapsed into one region)
  return r.medFont > 0 && r.medFont <= 11 && digits >= 8 && r.count >= 4;
}

export function classifyPage(
  page: PageIR,
  regions: Region[],
  index: number,
  total: number,
): { role: PageRole; evidence: string[] } {
  const ev: string[] = [];
  const texts = page.blocks.filter(isTextBlock);
  const n = texts.length;
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

  // technical spec table vs equipment list: BOTH are dense small-font pages, so density alone is
  // not enough — the technical spec is NUMERIC, the equipment list is SENTENCES. Require numbers.
  const digitCount = (allText.match(/\d/g) || []).length;
  const unitCount = (allText.match(new RegExp(KW.units.source, 'gi')) || []).length; // GLOBAL count
  const digitRatio = digitCount / Math.max(1, allText.length); // technical spec ≈ 0.04-0.09, equipment ≈ 0.01
  // Dense = a real data table: many similar-small-font runs, NO big hero image (that guard lives in
  // isDensePage, and is what keeps a marketing spread — big hero + heading + feature prose that
  // mentions "מערכת"/units — from being misread as a safety/spec DATA page).
  const dense = isDensePage(page);
  // heritage/timeline narrative: dense small text whose "numbers" are YEARS, with almost no
  // measurement units — a brand-story page, NOT a data table (was misclassified as spec).
  const yearCount = (allText.match(/\b(19|20)\d{2}\b/g) || []).length;
  if (dense && yearCount >= 4 && digitRatio < 0.04) {
    ev.push(`timeline/heritage narrative: ${yearCount} years, ratio ${digitRatio.toFixed(3)}`);
    return { role: 'feature', evidence: ev };
  }
  // a REAL spec page is numeric (ratio ≥0.03), not just "mentions units somewhere in prose"
  const numericSpec = dense && digitRatio >= 0.03 && (unitCount >= 2 || digitCount >= 40);
  if (numericSpec || (hit('engine') && digitRatio >= 0.03 && unitCount >= 3)) {
    ev.push(`spec (numeric): ${digitCount} digits, ratio ${digitRatio.toFixed(3)}, ${unitCount} units`);
    return { role: 'spec', evidence: ev };
  }
  // a dense page that is mostly TEXT (few numbers) = equipment / safety feature lists, NOT the spec
  if (dense && (hit('safety') || hit('equipment') || hit('colors'))) {
    ev.push(`dense textual list: ${n} runs, only ${digitCount} digits → equipment/safety`);
    return { role: 'safety', evidence: ev };
  }

  if (legalHeavy && index >= total - 2) {
    ev.push('legal/pollution near end');
    return { role: 'back', evidence: ev };
  }

  if (hit('price')) { ev.push('price terms'); return { role: 'price', evidence: ev }; }

  if ((hit('colors') || hit('wheels')) && index >= total - 5) {
    ev.push('colours / wheels selection near end');
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
/**
 * Infer a slot's kind. CONTENT-FIRST: each region is classified by its OWN text/shape, so a
 * region's kind no longer just inherits the page role (the bug behind "spec table → marketing
 * text" and "equipment list → colours"). The page role is only a fallback for ambiguous regions.
 */
function slotKind(role: PageRole, r: Region, isLargestText: boolean, early = false, pageHeight = 0): SlotKind {
  if (r.blockType === 'shape') return 'background';
  if (r.blockType === 'image') {
    // a small image high on the page is almost always a brand logo, not a hero photo
    const small = r.bbox.width <= 200 && r.bbox.height <= 120;
    if (small && r.bbox.y <= 120) return 'logo';
    return role === 'cover' || role === 'feature' ? 'hero-image' : 'image';
  }
  const t = r.text || '';
  // MARKETING pages (cover / feature / content / interior) and EARLY pages (before the first data
  // table) only carry cover/hero imagery, headings, model name, marketing copy — and occasionally a
  // legal disclaimer at the bottom. The data kinds (spec/equipment/safety/colours/wheels/pollution/
  // price) can ONLY live on their own data pages, so never assign them here even when the marketing
  // copy happens to mention a "מערכת"/unit/number (fixes "feature spread → spec-table/safety/equipment").
  if (early || MARKETING_ROLES.has(role)) {
    const nearBottom = pageHeight > 0 && r.bbox.y > pageHeight * 0.8;
    if (KW.legal.test(t) && t.length > 60 && nearBottom) return 'legal';
    if (role === 'cover' && isLargestText) return 'model-name';
    if (isLargestText && r.maxFont >= 18) return 'heading';
    // a mid-size lead line on a marketing page is a sub-heading, not body copy
    if (r.maxFont >= 22 && r.weight >= 600) return 'heading';
    return 'marketing-text';
  }
  // strong content signals win regardless of the page role
  if (KW.legal.test(t) && t.length > 60) return 'legal';
  if (KW.pollution.test(t)) return 'pollution';
  if (KW.price.test(t)) return 'price';
  if (looksLikeSpec(r)) return 'spec-table';
  if (KW.wheels.test(t) && !KW.colors.test(t)) return 'wheels';
  if (/ריפוד|פנים הרכב|תא הנוסעים|דמוי עור|בד\b/.test(t) && KW.colors.test(t)) return 'colors-interior';
  if (KW.colors.test(t) && !KW.safety.test(t) && !KW.equipment.test(t)) return 'colors';
  if (KW.safety.test(t)) return 'safety';
  if (KW.equipment.test(t)) return 'equipment'; // multimedia/seats/comfort equipment list
  if (role === 'cover' && isLargestText) return 'model-name';
  if (isLargestText && r.maxFont >= 18) return 'heading';
  // page-role fallback only for regions with no strong signal of their own
  if (role === 'spec') return 'spec-table';
  if (role === 'colors') return 'colors';
  if (role === 'safety') return 'safety';
  if (role === 'price') return 'price';
  if (role === 'back') return 'legal';
  return 'marketing-text';
}

export const SLOT_LABEL: Record<SlotKind, string> = {
  'model-name': 'שם הדגם',
  heading: 'כותרת',
  'marketing-text': 'טקסט שיווקי',
  'hero-image': 'תמונה ראשית',
  image: 'תמונה משנית',
  'spec-table': 'טבלת מפרט טכני',
  colors: 'צבעי חוץ',
  'colors-interior': 'צבעי פנים',
  wheels: 'חישוקים',
  safety: 'מערכות בטיחות',
  equipment: 'מפרט אבזור',
  pollution: 'דרגת זיהום',
  price: 'מחיר',
  legal: 'טקסט משפטי',
  logo: 'לוגו',
  background: 'רקע',
  text: 'טקסט',
};

/** Kinds that are inherently fixed brand furniture rather than per-model content.
 * NOTE: 'background' is NOT here — a shape's fixed/dynamic is decided by cross-doc
 * evidence so a per-model accent strip (fill differs across models) is caught as dynamic. */
const FIXED_KINDS = new Set<SlotKind>(['legal', 'logo']);

/** Page roles that carry marketing content only — never per-model data tables. On these, region
 * kinds are limited to heading/model-name/marketing/hero/logo/legal (data kinds are page-gated). */
const MARKETING_ROLES = new Set<PageRole>(['cover', 'feature', 'content', 'interior']);

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

/** Distinct values (text / shape fill / image src) seen for a matched region across docs. */
function distinctCount(ms: MatchedSlot): number {
  const vals = [norm(regionValue(ms.base)), ...ms.matches.map((m) => norm(regionValue(m)))].filter(Boolean);
  return new Set(vals).size;
}

/** Kinds that carry per-model content (used for the single-doc dynamic fallback). */
const DYNAMIC_KINDS = new Set<SlotKind>([
  'model-name', 'heading', 'marketing-text', 'hero-image', 'image',
  'spec-table', 'colors', 'colors-interior', 'wheels', 'safety', 'equipment', 'pollution', 'price',
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
  } else if (crossDoc && (blockType === 'text' || blockType === 'shape')) {
    // real evidence beats the kind heuristic: a region whose value (text / fill) differs
    // across models is dynamic; one identical across all models is fixed brand furniture.
    dynamic = group.some((g) => distinctCount(g) > 1);
    confidence = 0.9;
  } else {
    const bearsModel = modelTokens.some((t) => joinedText.toLowerCase().includes(t));
    dynamic = bearsModel || DYNAMIC_KINDS.has(kind);
    confidence = crossDoc ? 0.6 : 0.45;
  }

  const rep = bases.find((b) => b.text) || bases[0];
  const fill = blockType === 'shape' ? rep.fill : undefined;
  return {
    id, key, kind, blockType, dynamic, bbox,
    fill,
    style: styleOf(rep),
    label: SLOT_LABEL[kind],
    // full text (not truncated): generation falls back to `sample` for unbound dynamic slots
    sample: blockType === 'image' ? rep.src : blockType === 'shape' ? fill : joinedText,
    fixedContent: !dynamic && blockType === 'text' ? joinedText : undefined,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    variants,
    crossDocEvidence: crossDoc,
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/** Dense table page = many small-font runs → keep cells unclustered (preserve the grid). */
function isDensePage(page: PageIR): boolean {
  const texts = page.blocks.filter(isTextBlock);
  if (texts.length < 26) return false;
  // "small" is RELATIVE to the page's own heading size, not an absolute point size — a 1920×1080
  // deck's table body is ~15pt while a print-spread's is ~8pt, but both sit well under the page's
  // big heading. (An absolute `<10` missed the deck's spec tables entirely → columns blobbed.)
  const maxFont = Math.max(0, ...texts.map((t) => t.fontSize));
  const smallThresh = Math.max(11, maxFont * 0.45);
  const small = texts.filter((t) => t.fontSize < smallThresh).length;
  if (small / texts.length < 0.55) return false;
  // timeline/heritage narrative (years, no measurement units) is prose, not a grid — cluster it
  const allText = texts.map((t) => t.text).join(' ');
  const years = (allText.match(/\b(19|20)\d{2}\b/g) || []).length;
  const units = (allText.match(KW.units) || []).length;
  if (years >= 4 && units <= 1) return false;
  // PRIMARY table signal: a GRID OF SHORT CELLS. A real spec/equipment table is mostly short runs
  // (labels + values), so this wins even when the page carries a big DIMENSION DIAGRAM (a car-
  // dimensions image is 30-40% of a spec page — the marketing-image guard below would wrongly
  // demote it). Marketing prose fails this (its runs are multi-word sentences).
  const shortCells = texts.filter((t) => t.text.trim().split(/\s+/).length <= 4).length;
  if (shortCells >= texts.length * 0.6) return true;
  // Otherwise a hero spread — ONE big image, OR SEVERAL medium images covering a quarter+ of the
  // page — plus a heading is a MARKETING page, not a data table (even when the copy mentions
  // systems/units). (The single-image test alone missed 4-up feature spreads → "safety" data pages.)
  const pageArea = page.width * page.height;
  const imgs = page.blocks.filter(isImageBlock);
  const bigImage = imgs.some((im) => im.width * im.height >= pageArea * 0.22);
  const totalImg = imgs.reduce((s, im) => s + im.width * im.height, 0);
  const bigHeading = texts.some((t) => t.fontSize >= 18);
  if ((bigImage || totalImg >= pageArea * 0.25) && bigHeading) return false;
  // Narrative/marketing prose: many long sentences (≥8 words) rather than short table cells.
  const prose = texts.filter((t) => t.text.trim().split(/\s+/).length >= 8).length;
  if (prose >= 4 && prose >= texts.length * 0.22) return false;
  return true;
}

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

  const maxPages = base.pages.length;
  const DATA_ROLES = new Set<PageRole>(['spec', 'safety', 'colors', 'wheels', 'price']);
  const isLineShape = (r: Region) => r.blockType === 'shape' && Math.min(r.bbox.width, r.bbox.height) <= 3;

  // Grouping mode per page: a genuinely dense DATA TABLE groups into label→value ROWS; everything
  // else (marketing spreads, narrative) clusters as paragraphs. isDensePage carries the guards that
  // keep an image-heavy or prose marketing page — even one that mentions systems/units — OUT of
  // row mode, so its paragraphs don't shatter into per-line boxes.
  const docRegions = docs.map((d) => d.pages.map((p) => groupRegions(p, isDensePage(p) ? 'row' : 'para')));
  const baseRegions = docRegions[0];

  // Pre-pass: roles for every page, so we know where the DATA tables begin. Everything before the
  // first spec/equipment/colours/wheels/price page is an "early" (cover + marketing) page.
  const pageRoles = base.pages.map((p, pi) => classifyPage(p, baseRegions[pi].filter((r) => !isLineShape(r)), pi, maxPages).role);
  let firstDataIdx = pageRoles.findIndex((r) => DATA_ROLES.has(r));
  if (firstDataIdx < 0) firstDataIdx = maxPages;

  const pages: TemplatePageSpec[] = [];
  for (let pi = 0; pi < maxPages; pi++) {
    const early = pi < firstDataIdx;
    const page = base.pages[pi];
    const allRegions = baseRegions[pi];
    // thin shape regions = gridlines/rules → fixed design layer (too many to be slots);
    // panels (filled) + text + images go through slot learning.
    const isLine = (r: Region) => r.blockType === 'shape' && Math.min(r.bbox.width, r.bbox.height) <= 3;
    const designShapes = allRegions.filter(isLine);
    const regions = allRegions.filter((r) => !isLine(r));
    const { role, evidence } = classifyPage(page, regions, pi, maxPages);

    // same-index regions from the OTHER docs (skeleton aligns by index)
    const otherPages = docRegions.slice(1).map((dr) => dr[pi]?.filter((r) => !isLine(r))).filter((r): r is Region[] => !!r);
    const matched = matchPageRegions(regions, otherPages);

    const textMatched = matched.filter((m) => m.base.blockType === 'text' && m.base.text);
    const imageMatched = matched.filter((m) => m.base.blockType === 'image');
    const shapeMatched = matched.filter((m) => m.base.blockType === 'shape');
    const largestFont = Math.max(0, ...textMatched.map((m) => m.base.maxFont));

    const slots: SlotSpec[] = [];
    let si = 0;
    const push = (kind: SlotKind, group: MatchedSlot[]) => {
      if (!group.length) return;
      slots.push(buildSlot(`${page.id}_s${si}`, `p${pi + 1}.${kind}.${si}`, kind, group, modelTokens));
      si++;
    };

    // ONE slot per region — preserves the original layout at generation time (spec/safety
    // tables are positioned text: each cell stays a cell, so the grid is reproduced rather
    // than collapsed into a blob). Cross-doc evidence then makes column labels FIXED and the
    // per-model values DYNAMIC. The kind comes from the page role (spec→spec-table, etc).
    for (const m of textMatched) {
      const isLargest = m.base.maxFont === largestFont && largestFont > 0;
      push(slotKind(role, m.base, isLargest, early, page.height), [m]);
    }
    // shapes (design panels/strips) first so they sit under text/images at generation
    for (const m of shapeMatched) push('background', [m]);
    for (const m of imageMatched) push(slotKind(role, m.base, false, early, page.height), [m]);

    // deterministic stack order: by y then x
    slots.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

    // design layer = gridlines/rules only (panels stay reviewable 'background' slots above)
    const design = designShapes.map((r) => ({ bbox: r.bbox, fill: r.fill || '#999999', line: true }));
    pages.push({ index: pi, role, width: page.width, height: page.height, roleEvidence: evidence, slots, design });
  }

  // tokens: accent is per-model (brief) — flag dynamic if text colour varied
  const allColors = docRegions.flat().flat().filter((r) => r.blockType === 'text').map((r) => r.color);
  // real accent candidate: the dominant SATURATED (non-gray, non-black/white) text colour across
  // docs, now that text colours are exact from the op-list. Undefined if the copy is all neutral.
  const isSat = (hex?: string) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return false;
    const [r, g, b] = [1, 2, 3].map((k) => parseInt(m[k], 16));
    return Math.max(r, g, b) - Math.min(r, g, b) > 40 && Math.max(r, g, b) > 60;
  };
  const accentColors = allColors.filter(isSat);
  const tokens = {
    text: mode(allColors.length ? allColors : ['#111418']),
    accent: accentColors.length ? mode(accentColors) : undefined,
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
