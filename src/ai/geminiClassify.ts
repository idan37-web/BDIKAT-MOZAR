// Optional AI-assist for template learning via Google Gemini Flash (free tier).
// OFF by default. The heuristic learner runs first; this refines page ROLES and slot KINDS
// (and fixed/dynamic) for the whole template in ONE request. Network + an API key are required;
// on any error the caller keeps the heuristic result. Nothing is sent unless the user enables it.
import type { TemplateSpec, SlotKind, PageRole } from '../templates/templateSpec';
import { SLOT_LABEL } from '../templates/templateLearning';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

const ROLES: PageRole[] = ['cover', 'feature', 'interior', 'colors', 'wheels', 'safety', 'spec', 'price', 'back', 'content'];
const KINDS: SlotKind[] = [
  'model-name', 'heading', 'marketing-text', 'hero-image', 'image', 'spec-table', 'colors',
  'colors-interior', 'wheels', 'safety', 'equipment', 'pollution', 'price', 'legal', 'logo', 'background', 'text',
];
const ROLE_SET = new Set<string>(ROLES);
const KIND_SET = new Set<string>(KINDS);

export interface AiPageResult { index: number; role?: string; slots?: { id: string; kind?: string; dynamic?: boolean }[] }
export interface AiResult { pages: AiPageResult[] }

/** Compact, privacy-minimal page summaries (text truncated; no images sent). */
export function buildPagesPayload(spec: TemplateSpec) {
  return spec.pages.map((p) => ({
    index: p.index,
    size: `${Math.round(p.width)}x${Math.round(p.height)}`,
    regions: p.slots.filter((s) => s.blockType === 'text').slice(0, 70).map((s) => ({
      id: s.id,
      guess: s.kind,
      text: (s.sample || s.fixedContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      box: [Math.round(s.bbox.x), Math.round(s.bbox.y), Math.round(s.bbox.width), Math.round(s.bbox.height)],
      font: Math.round(s.style?.fontSize || 10),
    })),
    images: p.slots.filter((s) => s.blockType === 'image').map((s) => s.id),
  }));
}

function buildPrompt(spec: TemplateSpec): string {
  const pages = buildPagesPayload(spec);
  return [
    'אתה מסווג עמודים ואזורי-טקסט של תבנית חוברת רכב (עברית, RTL). לכל עמוד בחר תפקיד, ולכל אזור בחר סוג-סלוט והאם הוא דינמי (משתנה בין דגמים) או קבוע (אלמנט מותג קבוע).',
    `תפקידי עמוד אפשריים: ${ROLES.join(', ')}.`,
    `סוגי סלוט אפשריים: ${KINDS.join(', ')}.`,
    'הנחיות: "spec" = עמוד מפרט טכני (נתונים מספריים). "safety"/"equipment" = רשימות אבזור/בטיחות (משפטים). "colors"/"colors-interior" = צבעי חוץ/פנים. "spec-table" לאזורי טבלת מפרט, "equipment" לפריט אבזור, "legal" לטקסט משפטי, "logo" ללוגו מותג. ערכי מפרט/אבזור/צבעים הם דינמיים; תוויות-עמודה, טקסט מותג ומשפטי הם קבועים.',
    'החזר JSON בלבד במבנה: {"pages":[{"index":n,"role":"...","slots":[{"id":"...","kind":"...","dynamic":true|false}]}]}. השתמש אך ורק בערכים מהרשימות. אל תמציא id-ים — השתמש ב-id שניתנו.',
    'נתוני התבנית:',
    JSON.stringify({ brand: spec.brand, format: spec.format, pages }),
  ].join('\n');
}

/** Call Gemini once to classify the whole template. Throws on network/parse error. */
export async function classifyWithGemini(spec: TemplateSpec, apiKey: string, model = GEMINI_DEFAULT_MODEL): Promise<AiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(spec) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini החזיר תשובה ריקה');
  return parseAiResult(text);
}

/** Tolerant JSON parse (strips ``` fences / surrounding prose). */
export function parseAiResult(text: string): AiResult {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const obj = JSON.parse(t);
  return { pages: Array.isArray(obj?.pages) ? obj.pages : [] };
}

export interface ApplyStats { pagesChanged: number; slotsChanged: number; }

/** Merge an AI result into a copy of the spec: valid roles/kinds only; refresh labels; keep
 * everything the model didn't mention. Returns the new spec + a small change summary. */
export function applyAiToSpec(spec: TemplateSpec, ai: AiResult): { spec: TemplateSpec; stats: ApplyStats } {
  const next: TemplateSpec = structuredClone(spec);
  let pagesChanged = 0, slotsChanged = 0;
  const byIndex = new Map(next.pages.map((p) => [p.index, p]));
  for (const ap of ai.pages) {
    const page = byIndex.get(ap.index);
    if (!page) continue;
    let touched = false;
    if (ap.role && ROLE_SET.has(ap.role) && ap.role !== page.role) { page.role = ap.role as PageRole; touched = true; }
    const slotById = new Map(page.slots.map((s) => [s.id, s]));
    for (const as of ap.slots || []) {
      const slot = slotById.get(as.id);
      if (!slot) continue;
      let ch = false;
      if (as.kind && KIND_SET.has(as.kind) && as.kind !== slot.kind) { slot.kind = as.kind as SlotKind; slot.label = SLOT_LABEL[as.kind as SlotKind]; ch = true; }
      if (typeof as.dynamic === 'boolean' && as.dynamic !== slot.dynamic) { slot.dynamic = as.dynamic; if (!as.dynamic && slot.blockType === 'text') slot.fixedContent = slot.sample || slot.fixedContent; ch = true; }
      if (ch) { slot.confidence = Math.max(slot.confidence, 0.85); slotsChanged++; touched = true; }
    }
    if (touched) pagesChanged++;
  }
  return { spec: next, stats: { pagesChanged, slotsChanged } };
}
