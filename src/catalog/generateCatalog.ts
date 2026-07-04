// Stage 7 (C.9): generate a real catalog DocumentIR from a learned TemplateSpec.
// No hardcoded pages, no simulation: every slot becomes a real BlockIR that opens in
// the SAME editor (App/PageView) and exports via the SAME vector pipeline (exportPdf).
//  - fixed slots emit their learned content + style.
//  - dynamic slots emit the user's bound content (text or image), or fall back to the
//    learned sample as an editable placeholder.
import type {
  BlockIR, DocumentIR, ImageBlockIR, PageIR, TextBlockIR, ShapeBlockIR, TableBlockIR,
} from '../types/catalog';
import type { SlotKind, SlotSpec, TemplateSpec } from '../templates/templateSpec';

/** A user-supplied value for one dynamic slot, keyed by SlotSpec.key. */
export interface SlotBinding {
  key: string;
  text?: string;
  imageSrc?: string; // data URL or path
}
export type BindingMap = Record<string, SlotBinding>;

/** Dynamic slots the user MUST fill. Images are NOT required — an unbound image slot just
 * leaves a neutral empty frame at the template position (the user can fill it later in the editor). */
export const REQUIRED_KINDS = new Set<SlotKind>(['model-name']);

export interface MissingSlot {
  pageIndex: number;
  key: string;
  kind: SlotKind;
  label: string;
}

/** Validate that every required dynamic slot has a non-empty binding. */
export function validateCatalog(spec: TemplateSpec, bindings: BindingMap): MissingSlot[] {
  const missing: MissingSlot[] = [];
  for (const page of spec.pages) {
    for (const slot of page.slots) {
      if (slot.ignored || !slot.dynamic || !REQUIRED_KINDS.has(slot.kind)) continue;
      const b = bindings[slot.key];
      const filled = slot.blockType === 'image' ? !!b?.imageSrc : !!(b?.text && b.text.trim());
      if (!filled) missing.push({ pageIndex: page.index, key: slot.key, kind: slot.kind, label: slot.label });
    }
  }
  return missing;
}

/** A neutral placeholder image (labelled) for unbound image slots. */
function placeholderImage(label: string, w: number, h: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${Math.max(1, Math.round(w))}' height='${Math.max(1, Math.round(h))}'>` +
    `<rect width='100%' height='100%' fill='#e9eaee'/>` +
    `<rect x='1' y='1' width='${Math.max(1, Math.round(w) - 2)}' height='${Math.max(1, Math.round(h) - 2)}' fill='none' stroke='#b8bcc4' stroke-dasharray='6 5'/>` +
    `<text x='50%' y='50%' fill='#8a8f98' font-family='sans-serif' font-size='14' text-anchor='middle' dominant-baseline='middle'>${escapeXml(label)}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

function textContent(slot: SlotSpec, binding?: SlotBinding): { text: string; user: boolean } {
  if (slot.dynamic) {
    const t = binding?.text;
    if (t != null && t !== '') return { text: t, user: true };
    return { text: slot.sample || '', user: false }; // editable placeholder
  }
  return { text: slot.fixedContent ?? slot.sample ?? '', user: false };
}

function makeTextBlock(slot: SlotSpec, binding: SlotBinding | undefined, z: number, fallbackColor: string): TextBlockIR {
  const { text, user } = textContent(slot, binding);
  const st = slot.style || {};
  return {
    id: `${slot.id}_b`,
    type: 'text',
    x: slot.bbox.x, y: slot.bbox.y, width: slot.bbox.width, height: slot.bbox.height,
    rotation: 0, zIndex: z,
    source: user ? 'user' : 'generated',
    originalBBox: { ...slot.bbox },
    text,
    originalText: text,
    fontFamily: st.fontFamily || 'sans-serif',
    fontSize: st.fontSize || 14,
    fontWeight: st.fontWeight || 400,
    lineHeight: st.lineHeight || 1.2,
    color: st.color || fallbackColor,
    direction: st.direction || 'rtl',
    align: st.align || (st.direction === 'ltr' ? 'start' : 'end'),
  };
}

function makeImageBlock(slot: SlotSpec, binding: SlotBinding | undefined, z: number): ImageBlockIR {
  const bound = binding?.imageSrc;
  const sample = slot.sample && slot.sample.startsWith('data:') ? slot.sample : undefined;
  const src = bound || sample || placeholderImage(slot.label, slot.bbox.width, slot.bbox.height);
  return {
    id: `${slot.id}_b`,
    type: 'image',
    x: slot.bbox.x, y: slot.bbox.y, width: slot.bbox.width, height: slot.bbox.height,
    rotation: 0, zIndex: z,
    source: bound ? 'user' : 'generated',
    originalBBox: { ...slot.bbox },
    src,
    originalImageRef: src,
    fit: 'cover',
  };
}

function makeShapeBlock(slot: SlotSpec, binding: SlotBinding | undefined, z: number): ShapeBlockIR {
  // a dynamic accent shape may be re-coloured via binding.text (a "#rrggbb"); else learned fill
  const bound = slot.dynamic && binding?.text && /^#[0-9a-f]{6}$/i.test(binding.text.trim()) ? binding.text.trim() : undefined;
  const fill = bound || slot.fill || '#dddddd';
  return {
    id: `${slot.id}_b`,
    type: 'shape',
    x: slot.bbox.x, y: slot.bbox.y, width: slot.bbox.width, height: slot.bbox.height,
    rotation: 0, zIndex: z,
    source: bound ? 'user' : 'generated',
    originalBBox: { ...slot.bbox },
    fill,
  };
}

function makeTableBlock(slot: SlotSpec, z: number, fallbackColor: string): TableBlockIR {
  const t = slot.table!;
  return {
    id: `${slot.id}_b`, type: 'table',
    x: slot.bbox.x, y: slot.bbox.y, width: slot.bbox.width, height: slot.bbox.height,
    rotation: 0, zIndex: z, source: 'generated',
    originalBBox: { ...slot.bbox },
    columns: t.columns, colFractions: t.colFractions, rows: t.rows,
    rowHeight: t.rowHeight, fontFamily: t.fontFamily || 'sans-serif', fontSize: t.fontSize,
    color: t.color || fallbackColor, gridColor: '#d7dade', cellBg: '#ffffff', direction: 'rtl',
  };
}

export interface GenerateOptions {
  title?: string;
  /** Default text colour when a slot carries no learned colour. */
  textColor?: string;
}

/** Build a catalog DocumentIR from a TemplateSpec + user slot bindings. */
export function generateCatalog(
  spec: TemplateSpec,
  bindings: BindingMap = {},
  opts: GenerateOptions = {},
): DocumentIR {
  const fallbackColor = opts.textColor || spec.tokens.text || '#111418';
  const pages: PageIR[] = spec.pages.map((tp) => {
    const blocks: BlockIR[] = [];
    // paint order: fixed design (panels/gridlines) → shape slots → images → text (on top)
    (tp.design || []).forEach((d, i) => {
      const shape: ShapeBlockIR = {
        id: `${tp.index}_d${i}`, type: 'shape',
        x: d.bbox.x, y: d.bbox.y, width: d.bbox.width, height: d.bbox.height,
        rotation: 0, zIndex: d.line ? 500 + i : i, source: 'generated',
        originalBBox: { ...d.bbox }, fill: d.fill,
      };
      blocks.push(shape);
    });
    tp.slots.forEach((slot, i) => {
      if (slot.ignored) return; // user excluded this slot from generation
      if (slot.blockType === 'shape') blocks.push(makeShapeBlock(slot, bindings[slot.key], 100 + i));
    });
    tp.slots.forEach((slot, i) => {
      if (slot.ignored) return;
      if (slot.blockType === 'image') blocks.push(makeImageBlock(slot, bindings[slot.key], 1_000 + i));
    });
    tp.slots.forEach((slot, i) => {
      if (slot.ignored || !slot.table) return;
      if (slot.blockType === 'table') blocks.push(makeTableBlock(slot, 900_000 + i, fallbackColor));
    });
    tp.slots.forEach((slot, i) => {
      if (slot.ignored) return;
      if (slot.blockType === 'text') blocks.push(makeTextBlock(slot, bindings[slot.key], 1_000_000 + i, fallbackColor));
    });
    return {
      id: `gen_p${tp.index + 1}`,
      width: tp.width,
      height: tp.height,
      rotation: 0,
      originalPdfPageIndex: tp.index,
      blocks,
    };
  });

  return {
    id: `cat_${spec.brand}_${Date.now()}`,
    sourcePdfName: opts.title || `${spec.brand} · ${spec.family}`,
    brand: spec.brand,
    pages,
  };
}

/** Place the brand logo into every detected "logo" slot of an already-generated catalog. Matches
 * doc image blocks to spec logo slots by page index + box overlap, so it works for BOTH the plain
 * generate path and the structured (mapSheetToCatalog) path. Mutates and returns the doc. */
export function applyBrandLogos(doc: DocumentIR, spec: TemplateSpec, logoSrc?: string): DocumentIR {
  if (!logoSrc) return doc;
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
    const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const inter = ix * iy; const ua = a.width * a.height;
    return ua > 0 && inter / ua > 0.4;
  };
  spec.pages.forEach((tp, k) => {
    const page = doc.pages[k];
    if (!page) return;
    const logoSlots = tp.slots.filter((s) => s.kind === 'logo' && !s.ignored);
    for (const slot of logoSlots) {
      // prefer an exact id match (generate path); else the best box overlap (structured path)
      const block = page.blocks.find((b) => b.type === 'image' && b.id === `${slot.id}_b`)
        || page.blocks.find((b) => b.type === 'image' && overlaps(slot.bbox, b));
      if (block && block.type === 'image') {
        const img = block as ImageBlockIR;
        img.src = logoSrc; img.originalImageRef = logoSrc; img.fit = 'contain'; img.source = 'generated';
      }
    }
  });
  return doc;
}

/** All fillable (dynamic) slots, flattened for a binding form. */
export function dynamicSlots(spec: TemplateSpec): { pageIndex: number; role: string; slot: SlotSpec }[] {
  const out: { pageIndex: number; role: string; slot: SlotSpec }[] = [];
  for (const p of spec.pages) for (const s of p.slots) if (s.dynamic && !s.ignored) out.push({ pageIndex: p.index, role: p.role, slot: s });
  return out;
}
