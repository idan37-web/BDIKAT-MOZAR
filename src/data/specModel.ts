// Milestone D — structured-data ingestion.
// The "car-comparison schema": a brand/importer-neutral, structured description of
// ONE model's data (spec table + equipment features + colours + wheels + copy).
// This is the SOURCE the user maintains (Excel/CSV) and the target every adapter maps to.
// It is deliberately separate from the IR: the SpecSheet is DATA; generation turns it
// into IR BlockIRs (a TableBlockIR for the spec, text blocks for features/colours).

/** One spec row: a label, an optional unit, and one value per trim column. */
export interface SpecRow {
  label: string;
  /** Unit shown in the cell header, e.g. "ס״מ", "כ״ס" — extracted from a trailing "(…)". */
  unit?: string;
  /** Aligned to `SpecSheet.trims`. A single shared value may repeat across trims. */
  values: string[];
}

/** A titled group of spec rows (e.g. "מנוע בנזין", "מידות", "משקל", "כושר גרירה"). */
export interface SpecSection {
  title: string;
  rows: SpecRow[];
}

/** One equipment line, present/absent per trim (boolean grid). */
export interface FeatureItem {
  label: string;
  /** Aligned to `SpecSheet.trims`; true = included in that trim. */
  perTrim: boolean[];
}

export interface FeatureCategory {
  title: string;
  items: FeatureItem[];
}

export type ColorType = 'solid' | 'metallic' | 'pearl';

export interface ColorEntry {
  name: string;
  type: ColorType;
  /** Optional "#rrggbb" swatch, when known. */
  code?: string;
}

export interface WheelEntry {
  label: string;
  /** e.g. "19" or "225/55R19". */
  size?: string;
}

/** A complete structured description of one model's catalog data. */
export interface SpecSheet {
  brand?: string;
  model?: string;
  /** Trim/finish columns, e.g. ["GT","ALLURE"] or ["MAX","YOU"]. At least one. */
  trims: string[];
  sections: SpecSection[];
  features: FeatureCategory[];
  colors: ColorEntry[];
  wheels: WheelEntry[];
  marketingText?: string;
  legalText?: string;
  price?: string;
}

export function emptySheet(trims: string[] = ['בסיסי']): SpecSheet {
  return { trims: trims.slice(), sections: [], features: [], colors: [], wheels: [] };
}

/** Canonical invariant: every row's values / feature flags align to `trims.length`. A single
 * value broadcasts to all trims (a spec shared across finishes). Mutates and returns the sheet. */
export function normalizeSheet(s: SpecSheet): SpecSheet {
  const n = Math.max(1, s.trims.length);
  const pad = <T>(a: T[], fill: T): T[] => {
    const out = a.slice(0, n);
    if (out.length === 1 && n > 1) return new Array(n).fill(out[0]);
    while (out.length < n) out.push(fill);
    return out;
  };
  for (const sec of s.sections) for (const r of sec.rows) r.values = pad(r.values.map((v) => v ?? ''), '');
  for (const c of s.features) for (const it of c.items) it.perTrim = pad(it.perTrim, false);
  return s;
}

/** Total fillable cells — used by the UI to show "X values parsed". */
export function sheetStats(s: SpecSheet): {
  trims: number; sections: number; rows: number; features: number;
  colors: number; wheels: number; values: number;
} {
  const rows = s.sections.reduce((n, sec) => n + sec.rows.length, 0);
  const featureItems = s.features.reduce((n, c) => n + c.items.length, 0);
  const values = s.sections.reduce(
    (n, sec) => n + sec.rows.reduce((m, r) => m + r.values.filter((v) => v && v.trim()).length, 0),
    0,
  );
  return {
    trims: s.trims.length,
    sections: s.sections.length,
    rows,
    features: featureItems,
    colors: s.colors.length,
    wheels: s.wheels.length,
    values,
  };
}

/** Normalise a colour-type token (Hebrew or English) to ColorType. */
export function normalizeColorType(raw: string): ColorType {
  const t = (raw || '').trim().toLowerCase();
  if (/pearl|פנינה|פנינ/.test(t)) return 'pearl';
  if (/metal|מטאל|מטל/.test(t)) return 'metallic';
  return 'solid';
}

/** Parse a boolean-ish cell (1/0, V/—, כן/לא, true/false, ●/○). */
export function parseBool(raw: string): boolean {
  const t = (raw || '').trim().toLowerCase();
  if (!t) return false;
  return /^(1|v|x|✓|●|•|כן|true|yes|y|std|standard|סטנדרט)$/.test(t);
}
