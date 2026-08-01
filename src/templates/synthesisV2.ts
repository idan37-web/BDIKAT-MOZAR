// Template synthesis v2 (the semantic layer's consumer). v1 aligned cross-document regions by
// bbox+content only; v2 receives the classifier's per-block labels and:
//   1. groups pages ACROSS same-brand samples by pageType (nth cover ↔ nth cover, …);
//   2. aligns blocks BY ROLE FIRST, bbox second;
//   3. decides fixed/variable per the contract — same role + stable bbox + identical content →
//      FIXED; same role + varying content → VARIABLE slot named after the role;
//   4. single-sample learning falls back to the model's variability flags at REDUCED confidence.
// Iron rule holds: every label is attached to extractor-produced ids; all geometry (bboxes,
// styles, tables) is measured by our code. Blocks the classifier didn't label keep the v1
// heuristic path, so a partial/failed classification degrades gracefully.
import type { DocumentIR } from '../types/catalog';
import {
  detectFormat,
  type PageRole,
  type SlotKind,
  type SlotSpec,
  type TemplatePageSpec,
  type TemplateSpec,
} from './templateSpec';
import { groupRegions, classifyPage, SLOT_LABEL, modelTokenFromCover, type Region } from './templateLearning';
import { isTablePage } from './tableDetect';
import type { BlockRole, BlockSemantics, PageSemantics, PageType } from '../ai/semanticSchema';

// ---------------------------------------------------------------------------
// Contract-enum → TemplateSpec mappings (documented; the spec's own enums are unchanged)
// ---------------------------------------------------------------------------
export const PAGE_TYPE_TO_ROLE: Record<PageType, PageRole> = {
  cover: 'cover',
  model_overview: 'feature',
  trim_equipment: 'safety', // dense textual equipment list page (v1's 'safety' bucket)
  tech_spec: 'spec',
  safety: 'safety',
  colors_wheels: 'colors',
  legal: 'back',
  other: 'content',
};

export const ROLE_TO_KIND: Record<BlockRole, SlotKind> = {
  brand_logo: 'logo',
  model_name: 'model-name',
  trim_name: 'heading',
  section_heading: 'heading',
  hero_image: 'hero-image',
  gallery_image: 'image',
  spec_table: 'spec-table',
  equipment_list: 'equipment',
  price: 'price',
  legal_text: 'legal',
  footnote: 'legal',
  page_number: 'text',
  decorative: 'background',
  other: 'text',
};

/** Reverse map for recording USER CORRECTIONS as contract labels (kind → nearest role). */
export const KIND_TO_ROLE: Record<SlotKind, BlockRole> = {
  'model-name': 'model_name',
  heading: 'section_heading',
  'marketing-text': 'other',
  'hero-image': 'hero_image',
  image: 'gallery_image',
  'spec-table': 'spec_table',
  colors: 'equipment_list',
  'colors-interior': 'equipment_list',
  wheels: 'equipment_list',
  safety: 'equipment_list',
  equipment: 'equipment_list',
  pollution: 'legal_text',
  price: 'price',
  legal: 'legal_text',
  logo: 'brand_logo',
  background: 'decorative',
  text: 'other',
};

/** Reverse map: TemplateSpec page role → contract pageType (for corrections without semType). */
export const ROLE_TO_PAGE_TYPE: Record<PageRole, PageType> = {
  cover: 'cover',
  feature: 'model_overview',
  interior: 'model_overview',
  colors: 'colors_wheels',
  wheels: 'colors_wheels',
  safety: 'safety',
  spec: 'tech_spec',
  price: 'legal',
  back: 'legal',
  content: 'other',
};

/** Hebrew review labels for the contract roles (slots are NAMED AFTER THE ROLE). */
export const ROLE_LABEL_HE: Record<BlockRole, string> = {
  brand_logo: 'לוגו מותג',
  model_name: 'שם דגם',
  trim_name: 'שם רמת גימור',
  section_heading: 'כותרת מקטע',
  hero_image: 'תמונה ראשית',
  gallery_image: 'תמונת גלריה',
  spec_table: 'טבלת מפרט',
  equipment_list: 'רשימת אבזור',
  price: 'מחיר',
  legal_text: 'טקסט משפטי',
  footnote: 'הערת שוליים',
  page_number: 'מספר עמוד',
  decorative: 'אלמנט עיצובי',
  other: 'אחר',
};

// ---------------------------------------------------------------------------
// Region ↔ semantics join
// ---------------------------------------------------------------------------
export interface RegionSemantics { role: BlockRole; variability: 'fixed' | 'variable'; confidence: number; reason: string }

/** Attach the classifier's per-BLOCK labels to a learner REGION (a region merges several IR
 * blocks): majority role weighted by confidence; variable if ANY member is variable. */
export function regionSemantics(region: Region, sem: PageSemantics | null): RegionSemantics | null {
  if (!sem) return null;
  const byId = new Map(sem.blocks.map((b) => [b.id, b]));
  const members = region.ids.map((id) => byId.get(id)).filter((b): b is BlockSemantics => !!b);
  if (!members.length) return null;
  const score = new Map<BlockRole, number>();
  for (const m of members) score.set(m.role, (score.get(m.role) || 0) + m.confidence);
  const role = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ofRole = members.filter((m) => m.role === role);
  return {
    role,
    variability: members.some((m) => m.variability === 'variable') ? 'variable' : 'fixed',
    confidence: ofRole.reduce((s, m) => s + m.confidence, 0) / ofRole.length,
    reason: ofRole[0].reason,
  };
}

// ---------------------------------------------------------------------------
// Page + block alignment
// ---------------------------------------------------------------------------
const iou = (a: Region['bbox'], b: Region['bbox']): number => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.width * a.height + b.width * b.height - inter;
  return uni <= 0 ? 0 : inter / uni;
};

/** Map doc0's page pi to each other doc's page index by PAGE TYPE (nth occurrence of the same
 * type ↔ nth occurrence), falling back to the same index. */
export function alignPagesByType(types: (PageType | null)[][]): number[][] {
  const base = types[0];
  const occ = new Map<PageType, number>();
  return base.map((t, pi) => {
    const nth = t ? (occ.set(t, (occ.get(t) || 0) + 1), occ.get(t)! - 1) : -1;
    return types.slice(1).map((other) => {
      if (t && nth >= 0) {
        let seen = 0;
        for (let i = 0; i < other.length; i++) {
          if (other[i] === t) { if (seen === nth) return i; seen++; }
        }
      }
      return pi < other.length ? pi : -1; // fallback: same index
    });
  });
}

interface AlignedRegion { base: Region; baseSem: RegionSemantics | null; matches: { region: Region; sem: RegionSemantics | null }[] }

/** Align doc0's regions to each other doc's regions: SAME ROLE first (best IoU among same-role
 * candidates — role match accepts any overlap-or-near geometry), bbox IoU second (v1 rule). */
export function alignRegionsByRole(
  baseRegions: Region[], baseSem: PageSemantics | null,
  otherPages: { regions: Region[]; sem: PageSemantics | null }[],
): AlignedRegion[] {
  return baseRegions.map((base) => {
    const bs = regionSemantics(base, baseSem);
    const matches: AlignedRegion['matches'] = [];
    for (const other of otherPages) {
      let best: { region: Region; sem: RegionSemantics | null } | undefined;
      if (bs) {
        // role-first: among same-blockType regions with the SAME ROLE, take the closest bbox
        let bestScore = -1;
        for (const o of other.regions) {
          if (o.blockType !== base.blockType) continue;
          const os = regionSemantics(o, other.sem);
          if (!os || os.role !== bs.role) continue;
          const s = iou(base.bbox, o.bbox);
          if (s > bestScore) { bestScore = s; best = { region: o, sem: os }; }
        }
      }
      if (!best) {
        // bbox fallback (v1): best IoU above threshold
        let bestScore = 0.18;
        for (const o of other.regions) {
          if (o.blockType !== base.blockType) continue;
          const s = iou(base.bbox, o.bbox);
          if (s > bestScore) { bestScore = s; best = { region: o, sem: regionSemantics(o, other.sem) }; }
        }
      }
      if (best) matches.push(best);
    }
    return { base, baseSem: bs, matches };
  });
}

// ---------------------------------------------------------------------------
// Fixed / variable per the contract
// ---------------------------------------------------------------------------
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const valueOf = (r: Region): string =>
  r.blockType === 'shape' ? (r.fill || '') :
  r.blockType === 'image' ? (r.src || '') :
  r.blockType === 'table' && r.table ? r.table.rows.map((row) => row.cells.join('|')).join('\n') :
  r.text;

const STABLE_IOU = 0.4;

export interface V2Decision { dynamic: boolean; confidence: number; evidence: string }

/** The contract's decision table. `sameRoleMatches` = matches whose role equals the base role. */
export function decideV2(a: AlignedRegion): V2Decision {
  const bs = a.baseSem;
  if (a.matches.length >= 1) {
    const sameRole = bs ? a.matches.filter((m) => m.sem?.role === bs.role) : [];
    const pool = sameRole.length ? sameRole : a.matches;
    const stable = pool.every((m) => iou(a.base.bbox, m.region.bbox) >= STABLE_IOU);
    const values = new Set([norm(valueOf(a.base)), ...pool.map((m) => norm(valueOf(m.region)))]);
    const identical = values.size === 1;
    if (sameRole.length && stable && identical) {
      return { dynamic: false, confidence: 0.92, evidence: 'same role + stable bbox + identical content' };
    }
    if (sameRole.length && !identical) {
      return { dynamic: true, confidence: 0.9, evidence: 'same role, content varies across samples' };
    }
    // no role agreement — fall back to v1's evidence rule at slightly lower confidence
    return { dynamic: !identical, confidence: 0.75, evidence: identical ? 'bbox-matched, identical content' : 'bbox-matched, content varies' };
  }
  // single sample (or nothing matched): the MODEL's variability flag at reduced confidence
  if (bs) {
    return {
      dynamic: bs.variability === 'variable',
      confidence: Math.min(0.6, Math.max(0.3, bs.confidence * 0.7)),
      evidence: `single-sample: model says ${bs.variability} (${bs.confidence.toFixed(2)})`,
    };
  }
  return { dynamic: true, confidence: 0.35, evidence: 'single-sample, no semantics — assume variable' };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
/**
 * Learn a TemplateSpec from >=1 same-brand documents WITH per-page semantics.
 * `semantics[d][p]` is the validated classifier output for doc d page p (null → that page keeps
 * heuristic-only treatment). Geometry/styles/tables all come from the extractor.
 */
export function learnTemplateV2(
  docs: DocumentIR[],
  semantics: (PageSemantics | null)[][],
  opts: { family?: string } = {},
): TemplateSpec {
  if (!docs.length) throw new Error('learnTemplateV2: need at least one DocumentIR');
  const base = docs[0];
  const brand = docs.find((d) => d.brand && d.brand !== 'unknown')?.brand || base.brand || 'unknown';
  const format = detectFormat(base.pages[0]?.width || 0, base.pages[0]?.height || 1);

  // regions per doc/page (same grouping as v1)
  const docRegions = docs.map((d) => d.pages.map((p) => groupRegions(p, isTablePage(p) ? 'row' : 'para')));

  // page types per doc/page (null when the classifier didn't run on that page)
  const types: (PageType | null)[][] = docs.map((d, di) => d.pages.map((_, pi) => semantics[di]?.[pi]?.pageType ?? null));
  const pageMap = alignPagesByType(types);

  const isLine = (r: Region) => r.blockType === 'shape' && Math.min(r.bbox.width, r.bbox.height) <= 3;

  const pages: TemplatePageSpec[] = [];
  for (let pi = 0; pi < base.pages.length; pi++) {
    const page = base.pages[pi];
    const allRegions = docRegions[0][pi];
    const regions = allRegions.filter((r) => !isLine(r));
    const designShapes = allRegions.filter(isLine);
    const sem = semantics[0]?.[pi] ?? null;

    // heuristic role stays as the fallback + evidence trail; semantic pageType wins when present
    const heur = classifyPage(page, regions, pi, base.pages.length);
    const semType = sem?.pageType;
    const role: PageRole = semType ? PAGE_TYPE_TO_ROLE[semType] : heur.role;
    const evidence = semType ? [`semantic: ${semType}`, ...heur.evidence] : heur.evidence;

    // other docs' matched page (BY TYPE) with its regions + semantics
    const otherPages = pageMap[pi]
      .map((pj, di) => (pj >= 0 && docRegions[di + 1]?.[pj]
        ? { regions: docRegions[di + 1][pj].filter((r) => !isLine(r)), sem: semantics[di + 1]?.[pj] ?? null }
        : null))
      .filter((x): x is { regions: Region[]; sem: PageSemantics | null } => !!x);

    const aligned = alignRegionsByRole(regions, sem, otherPages);
    const largestFont = Math.max(0, ...regions.filter((r) => r.blockType === 'text').map((r) => r.maxFont));

    const slots: SlotSpec[] = [];
    let si = 0;
    for (const a of aligned) {
      const r = a.base;
      const bs = a.baseSem;
      const d = decideV2(a);
      // kind: the classifier's role maps into the generator's kind enum; unlabelled regions keep
      // a minimal geometric fallback (largest text = heading; image; shape=background; table)
      const kind: SlotKind = bs ? ROLE_TO_KIND[bs.role]
        : r.blockType === 'image' ? (role === 'cover' ? 'hero-image' : 'image')
        : r.blockType === 'shape' ? 'background'
        : r.blockType === 'table' ? 'spec-table'
        : (r.maxFont === largestFont && r.maxFont >= 18) ? 'heading' : 'marketing-text';
      const roleName = bs?.role || kind;
      slots.push({
        id: `${page.id}_v2s${si}`,
        key: `p${pi + 1}.${roleName}.${si}`, // slot NAMED AFTER THE ROLE (contract)
        kind,
        blockType: r.blockType,
        table: r.table,
        fill: r.blockType === 'shape' ? r.fill : undefined,
        dynamic: d.dynamic,
        bbox: r.bbox,
        style: r.blockType === 'text' ? {
          fontFamily: r.fontFamily, fontSize: Math.round(r.medFont * 10) / 10, fontWeight: r.weight,
          color: r.color, align: r.align, direction: r.direction, lineHeight: 1.2,
        } : undefined,
        label: bs ? ROLE_LABEL_HE[bs.role] : SLOT_LABEL[kind],
        sample: r.blockType === 'image' ? r.src : r.blockType === 'shape' ? r.fill : r.text,
        fixedContent: !d.dynamic && r.blockType === 'text' ? r.text : undefined,
        confidence: Math.round(d.confidence * 100) / 100,
        variants: new Set([norm(valueOf(r)), ...a.matches.map((m) => norm(valueOf(m.region)))].filter(Boolean)).size,
        crossDocEvidence: a.matches.length >= 1,
        srcIds: r.ids,
        semRole: bs?.role,
        semConfidence: bs ? Math.round(bs.confidence * 100) / 100 : undefined,
        semReason: bs?.reason,
      });
      si++;
    }
    slots.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

    pages.push({
      index: pi, role, width: page.width, height: page.height,
      roleEvidence: evidence, slots,
      design: designShapes.map((r) => ({ bbox: r.bbox, fill: r.fill || '#999999', line: true })),
      semType,
    });
  }

  return {
    id: `tpl_${brand}_${format}_${Date.now()}`,
    brand,
    family: opts.family || `${brand}-${format}`,
    format,
    learnedFrom: docs.map((d) => d.sourcePdfName || d.id),
    tokens: { text: '#111418', accentDynamic: true },
    pages,
    createdAt: new Date().toISOString(),
    version: 2,
  };
}

// keep the heuristic learner's cover-token util reachable for v2 consumers
export { modelTokenFromCover };
