// Milestone D — the canonical AutoSpec sheet format (round-trips through Excel/CSV).
// A single tagged sheet holds the whole SpecSheet: each row's FIRST cell is a record
// tag (Hebrew or English), so a dealer can fill it in Excel and "Save As CSV". This is
// the schema we derive from the real Peugeot/Citroën brochures and hand back as a template.
//
// Row shapes (tag in col A; Hebrew aliases accepted):
//   meta   | מטא      | key            | value
//   trims  | גרסאות   | <trim1> | <trim2> | …                (defines the column order)
//   spec   | מפרט     | section | label | unit | v1 | v2 | …  (values aligned to trims)
//   feature| אבזור    | category| label | b1 | b2 | …         (booleans aligned to trims)
//   color  | צבע      | name | type(solid/metallic/pearl) | code
//   wheel  | חישוק    | label | size
//   marketing|שיווק  | text…   ·  legal | משפטי | text…  ·  price | מחיר | text
// Blank rows and rows whose first cell starts with "#" are ignored (comments).

import {
  type SpecSheet, type SpecSection, type SpecRow, type FeatureCategory, type ColorEntry,
  type WheelEntry, emptySheet, normalizeColorType, parseBool,
} from './specModel';
import type { Cells } from './parseSheet';

export interface SheetIssue { row: number; message: string; cells: string[]; }
export interface SheetParseResult { sheet: SpecSheet; issues: SheetIssue[]; }

type Tag = 'meta' | 'trims' | 'spec' | 'feature' | 'color' | 'colorint' | 'wheel' | 'marketing' | 'legal' | 'price';

const TAG_ALIASES: Record<string, Tag> = {
  meta: 'meta', מטא: 'meta', כותרת: 'meta',
  trims: 'trims', גרסאות: 'trims', גרסה: 'trims', 'רמות גימור': 'trims', גימור: 'trims',
  spec: 'spec', מפרט: 'spec', 'מפרט טכני': 'spec', נתון: 'spec',
  feature: 'feature', אבזור: 'feature', מאפיין: 'feature', ציוד: 'feature', features: 'feature', בטיחות: 'feature',
  color: 'color', colour: 'color', צבע: 'color', צבעים: 'color', 'צבע חוץ': 'color', 'צבעי חוץ': 'color',
  colorint: 'colorint', 'color-int': 'colorint', 'צבע פנים': 'colorint', 'צבעי פנים': 'colorint', ריפוד: 'colorint',
  wheel: 'wheel', wheels: 'wheel', חישוק: 'wheel', חישוקים: 'wheel', 'גלגלי סגסוגת': 'wheel',
  marketing: 'marketing', שיווק: 'marketing', 'טקסט שיווקי': 'marketing', תיאור: 'marketing',
  legal: 'legal', משפטי: 'legal', 'טקסט משפטי': 'legal', הערות: 'legal',
  price: 'price', מחיר: 'price',
};

function tagOf(cell: string): Tag | null {
  const t = (cell || '').trim().toLowerCase();
  return TAG_ALIASES[t] ?? TAG_ALIASES[(cell || '').trim()] ?? null;
}

const META_KEYS: Record<string, 'brand' | 'model'> = {
  brand: 'brand', מותג: 'brand', יבואן: 'brand',
  model: 'model', דגם: 'model', רכב: 'model',
};

/** Split a label like "נפח מנוע (סמ״ק)" into { label, unit }. */
export function splitUnit(label: string): { label: string; unit?: string } {
  const m = /^(.*?)[\s]*[\(（]\s*([^()）]+?)\s*[\)）]\s*$/.exec(label.trim());
  if (m && m[2].length <= 12) return { label: m[1].trim(), unit: m[2].trim() };
  return { label: label.trim() };
}

/** Parse a tagged sheet (Cells) into a SpecSheet, collecting issues for the review UI. */
export function cellsToSheet(cells: Cells): SheetParseResult {
  const issues: SheetIssue[] = [];
  const sheet = emptySheet([]);
  const sections = new Map<string, SpecSection>();
  const featureCats = new Map<string, FeatureCategory>();
  let sawTrims = false;
  let sawTagged = false;
  const marketing: string[] = [];
  const legal: string[] = [];

  const ensureSection = (title: string): SpecSection => {
    let s = sections.get(title);
    if (!s) { s = { title, rows: [] }; sections.set(title, s); sheet.sections.push(s); }
    return s;
  };
  const ensureCat = (title: string): FeatureCategory => {
    let c = featureCats.get(title);
    if (!c) { c = { title, items: [] }; featureCats.set(title, c); sheet.features.push(c); }
    return c;
  };
  const fitTrims = (n: number) => { while (sheet.trims.length < n) sheet.trims.push(`גרסה ${sheet.trims.length + 1}`); };

  cells.forEach((rawRow, idx) => {
    const row = rawRow.map((c) => (c ?? '').trim());
    if (row.every((c) => c === '')) return;
    if (row[0].startsWith('#')) return;
    const tag = tagOf(row[0]);
    if (!tag) {
      // Loose fallback: a non-tagged data row → treat as a spec row under "כללי".
      // Only surface as an issue if it looks like it was MEANT to be tagged.
      if (!sawTagged) {
        const vals = row.slice(1).filter((c) => c !== '');
        if (row[0] && vals.length) {
          fitTrims(vals.length);
          const { label, unit } = splitUnit(row[0]);
          ensureSection('כללי').rows.push({ label, unit, values: padValues(vals, sheet.trims.length) });
          return;
        }
      }
      issues.push({ row: idx + 1, message: `שורה לא מזוהה (תג לא ידוע: "${row[0]}")`, cells: row });
      return;
    }
    sawTagged = true;
    switch (tag) {
      case 'meta': {
        const key = META_KEYS[(row[1] || '').toLowerCase()] || META_KEYS[row[1] || ''];
        if (key) sheet[key] = row[2] || '';
        else issues.push({ row: idx + 1, message: `מפתח מטא לא ידוע: "${row[1]}"`, cells: row });
        break;
      }
      case 'trims': {
        const names = row.slice(1).filter((c) => c !== '');
        if (!names.length) { issues.push({ row: idx + 1, message: 'שורת גרסאות ריקה', cells: row }); break; }
        sheet.trims = names;
        sawTrims = true;
        break;
      }
      case 'spec': {
        const section = row[1] || 'כללי';
        const { label, unit } = splitUnit(row[2] || '');
        if (!label) { issues.push({ row: idx + 1, message: 'שורת מפרט ללא תווית', cells: row }); break; }
        const explicitUnit = row[3] || unit;
        const vals = row.slice(4);
        const trimmed = trimTrailingEmpty(vals);
        fitTrims(Math.max(1, trimmed.length));
        const r: SpecRow = { label, unit: explicitUnit || undefined, values: padValues(trimmed, sheet.trims.length) };
        ensureSection(section).rows.push(r);
        break;
      }
      case 'feature': {
        const category = row[1] || 'כללי';
        const label = row[2] || '';
        if (!label) { issues.push({ row: idx + 1, message: 'שורת אבזור ללא תווית', cells: row }); break; }
        const bools = row.slice(3);
        const trimmed = trimTrailingEmpty(bools);
        fitTrims(Math.max(1, trimmed.length));
        ensureCat(category).items.push({ label, perTrim: padBools(trimmed.map(parseBool), sheet.trims.length) });
        break;
      }
      case 'color': case 'colorint': {
        const name = row[1] || '';
        if (!name) { issues.push({ row: idx + 1, message: 'שורת צבע ללא שם', cells: row }); break; }
        const c: ColorEntry = { name, type: normalizeColorType(row[2] || ''), code: validHex(row[3]), group: tag === 'colorint' ? 'interior' : 'exterior' };
        sheet.colors.push(c);
        break;
      }
      case 'wheel': {
        const label = row[1] || '';
        if (!label) { issues.push({ row: idx + 1, message: 'שורת חישוק ללא תווית', cells: row }); break; }
        const w: WheelEntry = { label, size: row[2] || undefined };
        sheet.wheels.push(w);
        break;
      }
      case 'marketing': marketing.push(row.slice(1).filter(Boolean).join(' ')); break;
      case 'legal': legal.push(row.slice(1).filter(Boolean).join(' ')); break;
      case 'price': sheet.price = row.slice(1).filter(Boolean).join(' '); break;
    }
  });

  if (marketing.length) sheet.marketingText = marketing.join('\n').trim();
  if (legal.length) sheet.legalText = legal.join('\n').trim();
  if (!sheet.trims.length) sheet.trims = ['בסיסי'];
  if (!sawTrims && sheet.trims.length > 1) {
    issues.push({ row: 0, message: `לא הוגדרה שורת "גרסאות"; זוהו ${sheet.trims.length} עמודות ערכים`, cells: [] });
  }
  // Re-pad every row/feature to the final trim count (trims may grow after first use).
  for (const sec of sheet.sections) for (const r of sec.rows) r.values = padValues(r.values, sheet.trims.length);
  for (const c of sheet.features) for (const it of c.items) it.perTrim = padBools(it.perTrim, sheet.trims.length);
  return { sheet, issues };
}

function trimTrailingEmpty(a: string[]): string[] {
  const b = a.slice();
  while (b.length && (b[b.length - 1] ?? '').trim() === '') b.pop();
  return b;
}
function padValues(vals: string[], n: number): string[] {
  const out = vals.slice(0, n).map((v) => (v ?? '').trim());
  // a single value broadcasts to all trims (common: a spec shared across finishes)
  if (out.length === 1 && n > 1) return new Array(n).fill(out[0]);
  while (out.length < n) out.push('');
  return out;
}
function padBools(vals: boolean[], n: number): boolean[] {
  const out = vals.slice(0, n);
  if (out.length === 1 && n > 1) return new Array(n).fill(out[0]);
  while (out.length < n) out.push(false);
  return out;
}
function validHex(s?: string): string | undefined {
  const t = (s || '').trim();
  return /^#[0-9a-f]{6}$/i.test(t) ? t : undefined;
}

/** Serialise a SpecSheet to canonical tagged Cells (round-trips with cellsToSheet). */
export function sheetToCells(sheet: SpecSheet): Cells {
  const rows: Cells = [];
  rows.push(['# AutoSpec — גיליון מפרט מובנה. מלא/ערוך ושמור כ-CSV (UTF-8).']);
  if (sheet.brand) rows.push(['meta', 'brand', sheet.brand]);
  if (sheet.model) rows.push(['meta', 'model', sheet.model]);
  rows.push(['trims', ...sheet.trims]);
  rows.push(['#', 'מפרט טכני: tag | קטגוריה | תווית | יחידה | ערך לכל גרסה']);
  for (const sec of sheet.sections) {
    for (const r of sec.rows) rows.push(['spec', sec.title, r.label, r.unit || '', ...r.values]);
  }
  if (sheet.features.length) rows.push(['#', 'אבזור: tag | קטגוריה | תווית | ✓ לכל גרסה (1/0)']);
  for (const c of sheet.features) {
    for (const it of c.items) rows.push(['feature', c.title, it.label, ...it.perTrim.map((b) => (b ? '1' : '0'))]);
  }
  if (sheet.colors.length) rows.push(['#', 'צבעים: tag(color=חוץ, colorint=פנים) | שם | סוג | קוד']);
  for (const c of sheet.colors) rows.push([c.group === 'interior' ? 'colorint' : 'color', c.name, c.type, c.code || '']);
  if (sheet.wheels.length) rows.push(['#', 'חישוקים: tag | תווית | מידה']);
  for (const w of sheet.wheels) rows.push(['wheel', w.label, w.size || '']);
  if (sheet.marketingText) for (const ln of sheet.marketingText.split('\n')) rows.push(['marketing', ln]);
  if (sheet.legalText) for (const ln of sheet.legalText.split('\n')) rows.push(['legal', ln]);
  if (sheet.price) rows.push(['price', sheet.price]);
  return rows;
}

/** A complete, self-documenting template (for "download a template" when there's no data).
 * Every field type the generator can use is represented, with a worked example per section. */
export function blankTemplateCells(trims: string[] = ['GT', 'ALLURE']): Cells {
  return [
    ['# AutoSpec — תבנית גיליון מפרט מובנה. מלא ושמור כ-CSV (UTF-8) או כ-Excel. שורות שמתחילות ב-# הן הערות.'],
    ['# העמודה הראשונה היא התג; אפשר עברית או אנגלית. אפשר כמה גיליונות ב-Excel — כולם ייקראו.'],
    ['meta', 'brand', 'פיג׳ו'],
    ['meta', 'model', '3008'],
    ['#', 'גרסאות/רמות גימור — מגדיר את העמודות לכל שורות הערך שאחריו'],
    ['trims', ...trims],
    ['#', '— מפרט טכני — tag | קטגוריה | תווית | יחידה | ערך לכל גרסה —'],
    ['spec', 'מנוע', 'סוג מנוע', '', 'בנזין', 'בנזין'],
    ['spec', 'מנוע', 'נפח מנוע', 'סמ״ק', '1199', '1199'],
    ['spec', 'מנוע', 'הספק מירבי', 'כ״ס', '130', '130'],
    ['spec', 'ביצועים', 'מהירות מירבית', 'קמ״ש', '201', '201'],
    ['spec', 'מידות', 'אורך כללי', 'ס״מ', '453.5', '453.5'],
    ['spec', 'מידות', 'רוחב כללי', 'ס״מ', '189', '189'],
    ['spec', 'משקל', 'משקל עצמי', 'ק״ג', '1450', '1450'],
    ['#', '— מערכות בטיחות / אבזור — tag=feature | קטגוריה | תווית | 1/0 לכל גרסה (1=קיים) —'],
    ['feature', 'בטיחות', '6 כריות אוויר', '1', '1'],
    ['feature', 'בטיחות', 'בקרת יציבות ESP', '1', '1'],
    ['feature', 'אבזור', 'מסך מולטימדיה 10״', '0', '1'],
    ['feature', 'אבזור', 'בקרת אקלים דו-אזורית', '1', '1'],
    ['#', '— צבעי חוץ — tag=color | שם | solid/metallic/pearl | קוד# (לא חובה) —'],
    ['color', 'לבן בנקיז', 'pearl', '#f3f4f6'],
    ['color', 'אפור פלטינום', 'metallic', '#9aa0a6'],
    ['#', '— צבעי פנים / ריפוד — tag=colorint —'],
    ['colorint', 'ריפוד בד שחור', 'solid', '#1d1f22'],
    ['#', '— חישוקים — tag=wheel | תווית | מידה —'],
    ['wheel', 'חישוקי סגסוגת', '19"'],
    ['#', '— טקסטים ומחיר —'],
    ['marketing', 'טקסט שיווקי קצר על הדגם.'],
    ['legal', 'הערות משפטיות / ט.ל.ח.'],
    ['price', 'החל מ-₪0'],
  ];
}
