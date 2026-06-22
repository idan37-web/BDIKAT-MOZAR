// Adapter for the user's REAL multi-sheet workbook format (one tab per category):
//   tabs יחידת הנעה / מידות ומשקלים / סוללה וטעינה → technical SPEC sections (numeric)
//   tabs בטיחות / אבזור                              → EQUIPMENT feature lists (V/X per trim)
// Layout inside every tab: column A = field label, columns B,C,… = value per trim; an optional
// header row 0 carries trim names or "V/X" markers. No tags — the tab NAME is the section title.
import type { NamedSheet } from './parseSheet';
import { type SpecSheet, type SpecSection, type FeatureCategory, emptySheet, normalizeSheet } from './specModel';

/** In the V/X convention V/✓ = included, X/✗/blank = NOT included (X must NOT be truthy here). */
const vxBool = (s: string) => /^(v|✓|✔|●|•|כן|yes|y|1|std|standard|סטנדרט)$/i.test((s || '').trim());
import { splitUnit, isTaggedFormat, cellsToSheet, type SheetIssue } from './specSheetFormat';

const FEATURE_TAB = /בטיחות|אבזור|ציוד|מערכות|safety|equipment|features/i;
const SKIP_TAB = /הוראות|הסבר|readme|instructions|מקרא/i;
const isVX = (s: string) => { const t = (s || '').trim(); return /^(v|x|✓|✗|✔|●|•|–|—|-)$/i.test(t) || /^v\s*\/\s*x$/i.test(t); };

/** Non-empty value cells after the label column, across a sheet's data rows. */
function valueColCount(cells: string[][]): number {
  let max = 0;
  for (const row of cells) {
    let last = 0;
    for (let c = 1; c < row.length; c++) if ((row[c] ?? '').trim() !== '') last = c;
    if (last > max) max = last;
  }
  return max; // number of trim columns (col 0 is the label)
}

/** Build a SpecSheet from the natural multi-sheet workbook. */
export function workbookToSheet(sheets: NamedSheet[]): { sheet: SpecSheet; issues: SheetIssue[] } {
  const issues: SheetIssue[] = [];
  const content = sheets.filter((s) => !SKIP_TAB.test(s.name) && s.cells.some((r) => r.some((c) => (c || '').trim())));

  // trims: prefer the header markers of a boolean (V/X) tab; else the widest value area seen.
  let nTrims = 0;
  for (const s of content) {
    const header = s.cells.find((r) => (r[0] ?? '').trim() === '' && r.slice(1).some((c) => isVX(c)));
    if (header) nTrims = Math.max(nTrims, header.slice(1).filter((c) => (c || '').trim() !== '').length);
  }
  if (!nTrims) nTrims = Math.max(1, ...content.map((s) => valueColCount(s.cells)));
  nTrims = Math.min(nTrims, 8) || 1;

  // trim names: a header row whose label cell is empty but value cells carry real names (not V/X)
  let trims: string[] | null = null;
  for (const s of content) {
    const header = s.cells.find((r) => (r[0] ?? '').trim() === '' && r.slice(1, 1 + nTrims).some((c) => (c || '').trim() && !isVX(c)));
    if (header) { trims = header.slice(1, 1 + nTrims).map((c, i) => (c || '').trim() || `גרסה ${i + 1}`); break; }
  }
  if (!trims) trims = Array.from({ length: nTrims }, (_, i) => `גרסה ${i + 1}`);

  const sheet: SpecSheet = emptySheet(trims);
  let usedSpec = false;
  let usedFeat = false;

  for (const s of content) {
    const feature = FEATURE_TAB.test(s.name);
    // data rows = a non-empty label in col 0 (skip header / blank rows)
    const dataRows = s.cells.filter((r) => { const a = (r[0] ?? '').trim(); return a !== '' && !a.startsWith('#'); });
    if (!dataRows.length) continue;

    if (feature) {
      const cat: FeatureCategory = { title: s.name.trim(), items: [] };
      for (const r of dataRows) {
        const vals = r.slice(1, 1 + nTrims);
        cat.items.push({ label: (r[0] || '').trim(), perTrim: pad(vals.map(vxBool), nTrims, false) });
      }
      if (cat.items.length) { sheet.features.push(cat); usedFeat = true; }
    } else {
      const sec: SpecSection = { title: s.name.trim(), rows: [] };
      for (const r of dataRows) {
        const { label, unit } = splitUnit((r[0] || '').trim());
        sec.rows.push({ label, unit, values: pad(r.slice(1, 1 + nTrims).map((v) => (v || '').trim()), nTrims, '') });
      }
      if (sec.rows.length) { sheet.sections.push(sec); usedSpec = true; }
    }
  }

  if (!usedSpec && !usedFeat) issues.push({ row: 0, message: 'לא זוהו נתונים בגיליונות (ודא עמודת תווית + ערכים).', cells: [] });
  return { sheet: normalizeSheet(sheet), issues };
}

export type DriveType = 'petrol' | 'hybrid' | 'phev' | 'ev';
export const DRIVE_LABELS: Record<DriveType, string> = {
  petrol: 'בנזין', hybrid: 'היברידי', phev: 'היברידי נטען (PHEV)', ev: 'חשמלי',
};

// Drive-unit fields per drive type (transcribed from the user's four real templates).
const ENGINE: Record<DriveType, string[]> = {
  petrol: ['מנוע', 'נפח מנוע (סמ״ק)', 'מספר בוכנות', 'מספר שסתומים', 'הספק מירבי (כ״ס)', 'הספק מירבי (סל״ד)', 'מומנט מירבי (קג״מ)', '0-100 (שניות)', 'מהירות מירבית (קמ״ש)', 'תיבת הילוכים', 'צריכת דלק משולבת'],
  hybrid: ['מנוע', 'נפח מנוע (סמ״ק)', 'מספר בוכנות', 'הספק מירבי (כ״ס) - בנזין', 'הספק מירבי (סל״ד) - בנזין', 'הספק מירבי (כ״ס) - חשמלי', 'הספק מירבי (סל״ד) - חשמלי', '0-100 (שניות)', 'מהירות מירבית (קמ״ש)', 'תיבת הילוכים', 'צריכת דלק משולבת'],
  phev: ['מנוע', 'נפח מנוע (סמ״ק)', 'מספר בוכנות', 'הספק מירבי משולב (כ״ס)', 'מומנט מירבי משולב (קג״מ)', 'הספק מירבי (כ״ס) - בנזין', 'מומנט מירבי (קג״מ) - בנזין', 'הספק מירבי (כ״ס) - חשמלי', 'מומנט מירבי (קג״מ) - חשמלי', 'טווח נסיעה חשמלי מרבי (ק״מ)', '0-100 (שניות)', 'מהירות מירבית (קמ״ש)', 'תיבת הילוכים', 'צריכת דלק משוקללת'],
  ev: ['מנוע', 'הספק מירבי (כ״ס)', 'הספק מירבי (סל״ד)', '0-100 (שניות)', 'מהירות מירבית (קמ״ש)', 'תיבת הילוכים', 'צריכת חשמל לפי תקן WLTP', 'טווח נסיעה לפי תקן WLTP'],
};
const HAS_BATTERY: Record<DriveType, boolean> = { petrol: false, hybrid: true, phev: true, ev: true };
const DIMS = ['אורך כללי (ס״מ)', 'רוחב כללי (ס״מ)', 'גובה (ס״מ)', 'מרחק בין סרנים (ס״מ)', 'מתלים מלפנים', 'מתלים מאחור', 'משקל עצמי (ק״ג)', 'משקל כללי מורשה (ק״ג)', 'נגרר ללא בלמים (ק״ג)', 'נגרר עם בלמים (ק״ג)', 'צמיגים', 'תא מטען (ל׳)'];

/** A downloadable template in the user's NATURAL multi-sheet format, tailored to a DRIVE TYPE
 * (the engine + battery sheets differ; dimensions / safety / equipment are shared). */
export function naturalTemplateSheets(drive: DriveType = 'phev', trims: string[] = ['גרסה 1', 'גרסה 2']): NamedSheet[] {
  const hdr = ['', ...trims];
  const vx = ['', ...trims.map(() => 'V/X')];
  const spec = (rows: string[]) => [hdr, ...rows.map((r) => [r, ...trims.map(() => '')])];
  const sheets: NamedSheet[] = [
    { name: 'יחידת הנעה', cells: spec(ENGINE[drive]) },
    { name: 'מידות ומשקלים', cells: spec(DIMS) },
  ];
  if (HAS_BATTERY[drive]) sheets.push({ name: 'סוללה וטעינה', cells: spec(['סוללה (KWh)', 'סוג סוללה', 'מתח (וולט)', 'הספק טעינה AC (kW)', 'הספק טעינה DC (kW)']) });
  sheets.push({ name: 'בטיחות', cells: [vx, ['7 כריות אוויר', '', ''], ['ESP – בקרת יציבות', '', ''], ['ABS', '', ''], ['בלימת חירום אקטיבית', '', ''], ['בקרת שיוט אדפטיבית', '', ''], ['# הוסיפו שורות לפי הצורך', '', '']] });
  sheets.push({ name: 'אבזור', cells: [vx, ['פנסים ראשיים LED', '', ''], ['מסך מולטימדיה', '', ''], ['בקרת אקלים', '', ''], ['חיישני חניה', '', ''], ['מצלמת רוורס', '', ''], ['# הוסיפו שורות לפי הצורך', '', '']] });
  return sheets;
}

/** Decide tagged vs natural and produce a SpecSheet either way. */
export function parseToSpecSheet(sheets: NamedSheet[]): { sheet: SpecSheet; issues: SheetIssue[]; format: 'tagged' | 'natural' } {
  const flat = sheets.flatMap((s) => s.cells);
  if (isTaggedFormat(flat)) { const r = cellsToSheet(flat); return { ...r, format: 'tagged' }; }
  const r = workbookToSheet(sheets);
  return { ...r, format: 'natural' };
}

function pad<T>(a: T[], n: number, fill: T): T[] {
  const out = a.slice(0, n);
  if (out.length === 1 && n > 1) return new Array(n).fill(out[0]);
  while (out.length < n) out.push(fill);
  return out;
}
