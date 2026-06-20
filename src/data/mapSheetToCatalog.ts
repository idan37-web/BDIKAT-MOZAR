// Milestone D — map a structured SpecSheet onto a learned TemplateSpec to populate a
// catalog with MINIMAL manual entry. Simple text fields (model name, marketing/legal/price)
// auto-bind to their slots; dense pages (spec / safety-features / colours) are rebuilt from
// the sheet via the layout engine. Anything the sheet does NOT cover is surfaced as "manual"
// so the user knows exactly what is left to fill (the fallback path stays available).
import type { BBox, BlockIR, DocumentIR, ShapeBlockIR } from '../types/catalog';
import type { TemplateSpec, TemplatePageSpec, SlotKind } from '../templates/templateSpec';
import { generateCatalog, type BindingMap, type SlotBinding } from '../catalog/generateCatalog';
import type { SpecSheet } from './specModel';
import { sheetStats } from './specModel';
import { layoutSpecTable, layoutFeatures, layoutColors, type LayoutStyle } from './specToBlocks';
import type { Measure } from '../catalog/autofit';

export type MapStatus = 'mapped' | 'manual';
export interface FieldMapping {
  /** e.g. "מפרט טכני", "שם דגם", "טקסט שיווקי". */
  label: string;
  kind: SlotKind | 'spec' | 'features' | 'colors';
  pageIndex: number;
  status: MapStatus;
  /** Human note: where it came from, or what is still needed. */
  detail: string;
}

export interface MapResult {
  doc: DocumentIR;
  mappings: FieldMapping[];
  /** convenience: just the items needing manual entry. */
  manual: FieldMapping[];
  warnings: string[];
}

export interface MapOptions {
  /** Extra/override bindings (e.g. a hero image the user picked). */
  bindings?: BindingMap;
  /** Auto-fit measurer (font.widthOfTextAtSize in the gate, canvas in the browser). */
  measure?: Measure;
  title?: string;
}

const SPEC_ROLES = new Set(['spec']);
const FEATURE_ROLES = new Set(['safety', 'colors']); // equipment/feature lists live here
const COLOR_ROLES = new Set(['colors', 'wheels']);

/** A generous content region for a dense rebuild: the page minus outer margins. Using the
 * page (not the tight slot union) guarantees room for every spec/feature row. */
function denseRegion(tp: TemplatePageSpec): BBox {
  const mx = tp.width * 0.05, my = tp.height * 0.07;
  return { x: mx, y: my, width: tp.width - 2 * mx, height: tp.height - 2 * my };
}

/** Keep only the fixed BACKGROUND PANELS of a generated page — drop the learned thin
 * gridlines (they belonged to the OLD table) and the slot cells, so our freshly laid-out
 * table/list owns the grid. */
function designShapesOf(page: DocumentIR['pages'][number], tp: TemplatePageSpec): BlockIR[] {
  const panelIds = new Set((tp.design || []).map((d, i) => (d.line ? null : `${tp.index}_d${i}`)).filter(Boolean) as string[]);
  return page.blocks.filter((b) => panelIds.has(b.id) && (b.type === 'shape' || b.type === 'background')) as ShapeBlockIR[];
}

function styleFrom(spec: TemplateSpec, base: number): LayoutStyle {
  return {
    fontFamily: spec.tokens.fonts?.body || 'sans-serif',
    fontSize: base,
    color: spec.tokens.text || '#111418',
    headingColor: spec.tokens.accent || spec.tokens.text || '#111418',
    gridColor: '#d7dade',
    lineHeight: 1.15,
  };
}

/** Derive slot bindings from the sheet for the simple text fields. */
function autoBindings(spec: TemplateSpec, sheet: SpecSheet): { bindings: BindingMap; filled: Set<SlotKind> } {
  const bindings: BindingMap = {};
  const filled = new Set<SlotKind>();
  const put = (kind: SlotKind, text?: string) => {
    if (!text || !text.trim()) return;
    for (const p of spec.pages) for (const s of p.slots) {
      if (s.dynamic && s.kind === kind && !bindings[s.key]) {
        const b: SlotBinding = { key: s.key, text };
        bindings[s.key] = b; filled.add(kind);
      }
    }
  };
  const modelName = [sheet.brand, sheet.model].filter(Boolean).join(' ').trim();
  put('model-name', modelName || sheet.model);
  put('heading', modelName || sheet.model);
  put('marketing-text', sheet.marketingText);
  put('legal', sheet.legalText);
  put('price', sheet.price);
  return { bindings, filled };
}

/**
 * Populate a catalog from a structured sheet.
 *  - simple text slots auto-bind from the sheet;
 *  - spec / feature / colour pages are rebuilt by the layout engine from the sheet;
 *  - everything else (hero/interior images, unfilled text) is reported as "manual".
 */
export function mapSheetToCatalog(spec: TemplateSpec, sheet: SpecSheet, opts: MapOptions = {}): MapResult {
  const stats = sheetStats(sheet);
  const { bindings: autoB, filled } = autoBindings(spec, sheet);
  const bindings: BindingMap = { ...autoB, ...(opts.bindings || {}) };
  const doc = generateCatalog(spec, bindings, { title: opts.title });

  const mappings: FieldMapping[] = [];
  const warnings: string[] = [];
  const measure = opts.measure;

  // rebuild dense pages from the sheet
  spec.pages.forEach((tp, pi) => {
    const page = doc.pages[pi];
    const region = denseRegion(tp);
    const base = tp.slots.find((s) => s.style?.fontSize)?.style?.fontSize || (tp.role === 'spec' ? 9 : 10);

    if (SPEC_ROLES.has(tp.role) && stats.rows > 0) {
      const st = styleFrom(spec, base);
      const lay = layoutSpecTable(sheet, region, st, { title: 'מפרט טכני', measure, minScale: 0.75 });
      page.blocks = [...designShapesOf(page, tp), ...lay.blocks];
      mappings.push({ label: 'מפרט טכני', kind: 'spec', pageIndex: tp.index, status: 'mapped', detail: `${stats.rows} שורות · ${stats.trims} גרסאות` });
      if (lay.overflowRows > 0) warnings.push(`עמוד ${tp.index + 1}: ${lay.overflowRows} שורות מפרט לא נכנסו (דורש המשך/הקטנה).`);
    } else if (COLOR_ROLES.has(tp.role) && (stats.colors > 0 || stats.wheels > 0)) {
      const st = styleFrom(spec, base);
      const lay = layoutColors(sheet, region, st);
      page.blocks = [...designShapesOf(page, tp), ...lay.blocks];
      mappings.push({ label: 'צבעים וחישוקים', kind: 'colors', pageIndex: tp.index, status: 'mapped', detail: `${stats.colors} צבעים · ${stats.wheels} חישוקים` });
      if (lay.overflowRows > 0) warnings.push(`עמוד ${tp.index + 1}: ${lay.overflowRows} פריטי צבע/חישוק לא נכנסו.`);
    } else if (FEATURE_ROLES.has(tp.role) && stats.features > 0) {
      const st = styleFrom(spec, base);
      const lay = layoutFeatures(sheet.features, sheet.trims, region, st, { measure });
      page.blocks = [...designShapesOf(page, tp), ...lay.blocks];
      mappings.push({ label: 'אבזור ובטיחות', kind: 'features', pageIndex: tp.index, status: 'mapped', detail: `${stats.features} פריטי אבזור` });
      if (lay.overflowRows > 0) warnings.push(`עמוד ${tp.index + 1}: ${lay.overflowRows} פריטי אבזור לא נכנסו.`);
    }
  });

  // report simple text fields
  const reportKind = (kind: SlotKind, label: string) => {
    const exists = spec.pages.some((p) => p.slots.some((s) => s.dynamic && s.kind === kind));
    if (!exists) return;
    const pageIndex = spec.pages.find((p) => p.slots.some((s) => s.dynamic && s.kind === kind))?.index ?? 0;
    const ok = filled.has(kind);
    mappings.push({ label, kind, pageIndex, status: ok ? 'mapped' : 'manual', detail: ok ? 'מהגיליון' : 'אין בגיליון — מילוי ידני' });
  };
  reportKind('model-name', 'שם דגם');
  reportKind('marketing-text', 'טקסט שיווקי');
  reportKind('legal', 'טקסט משפטי');
  reportKind('price', 'מחיר');

  // image slots are never in the sheet → always manual (fallback path)
  const imageKinds = new Map<SlotKind, string>([['hero-image', 'תמונת נושא'], ['image', 'תמונה']]);
  for (const [kind, label] of imageKinds) {
    const slots = spec.pages.flatMap((p) => p.slots.filter((s) => s.dynamic && s.kind === kind).map((s) => ({ s, p })));
    for (const { s, p } of slots) {
      const bound = !!bindings[s.key]?.imageSrc;
      mappings.push({ label: `${label}: ${s.label}`, kind, pageIndex: p.index, status: bound ? 'mapped' : 'manual', detail: bound ? 'נבחרה ידנית' : 'יש לבחור תמונה' });
    }
  }

  const manual = mappings.filter((m) => m.status === 'manual');
  return { doc, mappings, manual, warnings };
}
