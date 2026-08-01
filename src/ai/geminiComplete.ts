// Optional AI-assist for CATALOG CREATION: fill the MISSING marketing / equipment / legal copy
// of a SpecSheet from free source material (text the user pastes, or text extracted from a PDF
// about the model). OFF by default; needs a key + network. The structured numeric spec is NEVER
// invented here — only marketing prose, equipment bullets, and legal text are completed.
import type { SpecSheet } from '../data/specModel';
import { GEMINI_COMPLETE_DEFAULT } from './models';

// A capable-yet-free Flash model. Defaults to the newest generation (Gemini 3 Flash); the user
// can pick an older 2.x Flash from the model selector if their key lacks access.
export const COMPLETE_DEFAULT_MODEL = GEMINI_COMPLETE_DEFAULT;

/** Pull http(s) URLs out of the source so we can ask Gemini to read them (url_context tool). */
export function extractUrls(s: string): string[] {
  const m = s.match(/https?:\/\/[^\s)"'<>]+/gi) || [];
  return [...new Set(m)].slice(0, 5);
}

export interface SheetCompletion {
  marketingText?: string;
  legalText?: string;
  /** Suggested equipment bullets, grouped by category title (added as included on all trims). */
  features?: { title: string; items: string[] }[];
  /** Copy written for specific empty TEXT regions of the catalog (cover/feature pages), by slot key. */
  slotFills?: { key: string; text: string }[];
}

/** An empty marketing/heading region of the template the AI should write copy for. */
export interface CopySlot {
  key: string;
  kind: string;       // marketing-text | heading | model-name | text
  page: number;       // page index (lower = earlier; the "first pages")
  sample?: string;    // the learned placeholder, for tone/length reference
  maxChars: number;   // rough budget so the copy fits the box
}

/** What is currently missing — drives both the prompt and the "apply only if empty" merge. */
function missingSummary(sheet: SpecSheet): string {
  const want: string[] = [];
  if (!sheet.marketingText?.trim()) want.push('marketingText (פסקת שיווק קצרה, 2–4 משפטים)');
  if (!sheet.legalText?.trim()) want.push('legalText (הערת שוליים/אחריות משפטית קצרה)');
  if (!sheet.features.some((c) => c.items.length)) want.push('features (3–8 שורות אבזור/בטיחות בולטות)');
  return want.join('; ') || 'אין שדות חסרים מובהקים — שפר רק אם יש מידע ודאי במקור.';
}

function buildPrompt(sheet: SpecSheet, source: string, urls: string[], slots: CopySlot[]): string {
  const existing = {
    brand: sheet.brand, model: sheet.model, trims: sheet.trims,
    sections: sheet.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => r.label) })),
    featureTitles: sheet.features.map((c) => c.title),
    hasMarketing: !!sheet.marketingText?.trim(), hasLegal: !!sheet.legalText?.trim(),
  };
  return [
    'אתה כותב תוכן שיווקי לקטלוג רכב בעברית (RTL). מטרתך: להשלים את כל הטקסטים השיווקיים החסרים על סמך חומר המקור שסופק.',
    'חוקים: (1) אל תמציא נתונים מספריים, מחירים, או מפרט טכני — רק טקסט שיווקי/אבזור/משפטי. (2) כתוב עברית תקנית, שיווקית וזורמת, בטון מותג. (3) השתמש רק במידע שמופיע או נרמז במקור.',
    urls.length ? `קרא וסכם את תוכן העמודים בכתובות הבאות (השתמש בכלי url_context): ${urls.join(' , ')}` : '',
    `שדות גיליון למילוי (אם חסרים): ${missingSummary(sheet)}.`,
    slots.length
      ? 'בנוסף — כתוב טקסט שיווקי לכל אחד מאזורי הטקסט הריקים של עמודי הקטלוג הראשונים (slots). לכל slot כתוב טקסט מתאים לסוג (kind) ובאורך שמתאים ל-maxChars (כותרות = קצרות; marketing-text = פסקה שיווקית). החזר אותם תחת slotFills לפי ה-key המדויק. אל תמציא key חדש. מלא כמה שיותר מהם.'
      : '',
    slots.length ? `אזורי הטקסט הריקים (slots): ${JSON.stringify(slots)}` : '',
    'החזר JSON בלבד במבנה: {"marketingText":"...", "legalText":"...", "features":[{"title":"אבזור","items":["..."]}], "slotFills":[{"key":"...","text":"..."}]}. השמט שדות שאין לך עבורם תוכן ודאי.',
    'נתוני הגיליון הקיימים (אל תשכפל מה שכבר קיים):',
    JSON.stringify(existing),
    'חומר המקור (טקסט חופשי על הדגם):',
    source.replace(/\s+/g, ' ').trim().slice(0, 12000) || '(אין טקסט חופשי — הסתמך על הכתובות שלמעלה)',
  ].filter(Boolean).join('\n');
}

/** Call Gemini once to complete the missing copy. Retries transient 429/503 with backoff.
 * `slots` = the empty marketing/heading regions of the first catalog pages to write copy for. */
export async function completeSheetWithGemini(
  sheet: SpecSheet, source: string, apiKey: string, model = COMPLETE_DEFAULT_MODEL, slots: CopySlot[] = [],
): Promise<SheetCompletion> {
  const urls = extractUrls(source);
  if (!source.trim()) throw new Error('אין חומר מקור. הדבק טקסט/קישור על הדגם או טען קובץ PDF.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // With the url_context tool we DROP responseMimeType (structured-output + tools can conflict)
  // and rely on the tolerant parser; without URLs we keep strict JSON output. More tokens are
  // needed when writing copy for many slots, so lift the output cap.
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(sheet, source, urls, slots) }] }],
    generationConfig: {
      temperature: 0.5, maxOutputTokens: 4096,
      ...(urls.length ? {} : { responseMimeType: 'application/json' }),
    },
    ...(urls.length ? { tools: [{ url_context: {} }] } : {}),
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
      if (!text) throw new Error('Gemini החזיר תשובה ריקה');
      return parseCompletion(text);
    }
    const errText = (await res.text()).slice(0, 400);
    lastErr = `Gemini ${res.status}: ${errText}`;
    if (res.status === 429 || res.status === 503) {
      const m = /"retryDelay":\s*"?(\d+)s/.exec(errText);
      const wait = m ? Math.min(30, +m[1]) * 1000 : 1500 * (attempt + 1) ** 2;
      if (attempt < 2) { await sleep(wait); continue; }
      throw new Error(`חריגת מכסה (429). נסה שוב בעוד דקה, או בחר מודל אחר (למשל gemini-2.0-flash). מקור: ${errText.slice(0, 160)}`);
    }
    if (res.status === 400 || res.status === 403) throw new Error(`מפתח/הרשאה (${res.status}). ודא מפתח תקין מ-aistudio.google.com. ${errText.slice(0, 160)}`);
    if (res.status === 404) throw new Error(`המודל "${model}" לא נמצא. בחר מודל אחר. ${errText.slice(0, 120)}`);
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Gemini: נכשל לאחר 3 ניסיונות');
}

/** Tolerant JSON parse (strips ``` fences / surrounding prose). */
export function parseCompletion(text: string): SheetCompletion {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const obj = JSON.parse(t);
  const out: SheetCompletion = {};
  if (typeof obj?.marketingText === 'string' && obj.marketingText.trim()) out.marketingText = obj.marketingText.trim();
  if (typeof obj?.legalText === 'string' && obj.legalText.trim()) out.legalText = obj.legalText.trim();
  if (Array.isArray(obj?.features)) {
    out.features = obj.features
      .filter((f: any) => f && typeof f.title === 'string' && Array.isArray(f.items))
      .map((f: any) => ({ title: String(f.title).trim(), items: f.items.map((x: any) => String(x).trim()).filter(Boolean) }))
      .filter((f: { items: string[] }) => f.items.length);
  }
  if (Array.isArray(obj?.slotFills)) {
    out.slotFills = obj.slotFills
      .filter((s: any) => s && typeof s.key === 'string' && typeof s.text === 'string' && s.text.trim())
      .map((s: any) => ({ key: String(s.key), text: String(s.text).trim() }));
  }
  return out;
}

export interface CompletionStats { marketing: boolean; legal: boolean; featureItems: number; }

/** Merge a completion into a COPY of the sheet. Fills marketing/legal only when currently empty;
 * adds feature bullets (included on all trims) into a matching category or a new one. Returns the
 * new sheet + a small change summary. */
export function applyCompletion(sheet: SpecSheet, c: SheetCompletion): { sheet: SpecSheet; stats: CompletionStats } {
  const next: SpecSheet = structuredClone(sheet);
  const stats: CompletionStats = { marketing: false, legal: false, featureItems: 0 };
  if (c.marketingText && !next.marketingText?.trim()) { next.marketingText = c.marketingText; stats.marketing = true; }
  if (c.legalText && !next.legalText?.trim()) { next.legalText = c.legalText; stats.legal = true; }
  const nTrims = Math.max(1, next.trims.length);
  for (const fc of c.features || []) {
    let cat = next.features.find((x) => x.title.trim() === fc.title.trim());
    if (!cat) { cat = { title: fc.title, items: [] }; next.features.push(cat); }
    const have = new Set(cat.items.map((it) => it.label.trim()));
    for (const label of fc.items) {
      if (have.has(label.trim())) continue;
      cat.items.push({ label, perTrim: new Array(nTrims).fill(true) });
      have.add(label.trim()); stats.featureItems++;
    }
  }
  return { sheet: next, stats };
}
