// Stage 7 (C.9): generate a real catalog DocumentIR from a learned TemplateSpec.
// No hardcoded pages, no simulation: every slot becomes a real BlockIR that opens in
// the SAME editor (App/PageView) and exports via the SAME vector pipeline (exportPdf).
//  - fixed slots emit their learned content + style.
//  - dynamic slots emit the user's bound content (text or image), or fall back to the
//    learned sample as an editable placeholder.
import type {
  BlockIR, DocumentIR, ImageBlockIR, PageIR, TextBlockIR, ShapeBlockIR,
} from '../types/catalog';
import type { SlotKind, SlotSpec, TemplateSpec } from '../templates/templateSpec';

/** A user-supplied value for one dynamic slot, keyed by SlotSpec.key. */
export interface SlotBinding {
  key: string;
  text?: string;
  imageSrc?: string; // data URL or path
}
export type BindingMap = Record<string, SlotBinding>;

/** Dynamic slots the user MUST fill for a sensible catalog. */
export const REQUIRED_KINDS = new Set<SlotKind>(['model-name', 'hero-image']);

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
      if (!slot.dynamic || !REQUIRED_KINDS.has(slot.kind)) continue;
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
    // paint order: shapes (under) → images → text (on top); deterministic z from slot order
    tp.slots.forEach((slot, i) => {
      if (slot.blockType === 'shape') blocks.push(makeShapeBlock(slot, bindings[slot.key], i));
    });
    tp.slots.forEach((slot, i) => {
      if (slot.blockType === 'image') blocks.push(makeImageBlock(slot, bindings[slot.key], 1_000 + i));
    });
    tp.slots.forEach((slot, i) => {
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

/** All fillable (dynamic) slots, flattened for a binding form. */
export function dynamicSlots(spec: TemplateSpec): { pageIndex: number; role: string; slot: SlotSpec }[] {
  const out: { pageIndex: number; role: string; slot: SlotSpec }[] = [];
  for (const p of spec.pages) for (const s of p.slots) if (s.dynamic) out.push({ pageIndex: p.index, role: p.role, slot: s });
  return out;
}
