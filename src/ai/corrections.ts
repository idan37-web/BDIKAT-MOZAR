// Per-brand user-correction store. Every correction made on the review screen is persisted;
// the 2 MOST RECENTLY corrected pages are injected as few-shot examples into future classifier
// calls for that brand (the model learns the brand's conventions from the user, not from us).
import type { CompactBlock, FewShotExample } from './provider';
import type { PageSemantics } from './semanticSchema';
import { pageSemanticsSchema } from './semanticSchema';
import type { KV } from './semanticCache';

export interface CorrectionRecord {
  /** identifies the corrected page (for replacement when re-corrected). */
  fileHash: string;
  pageIndex: number;
  correctedAt: string;
  blocks: CompactBlock[];
  labels: PageSemantics;
}

const MAX_PER_BRAND = 10;
const FEW_SHOT = 2;
const keyOf = (brand: string) => `autospec.sem.corrections.${brand || 'unknown'}`;

function defaultKV(): KV {
  if (typeof localStorage !== 'undefined') {
    return {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota — drop oldest next write */ } },
    };
  }
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
}

export function loadCorrections(brand: string, kv: KV = defaultKV()): CorrectionRecord[] {
  try {
    const raw = kv.get(keyOf(brand));
    if (!raw) return [];
    const arr = JSON.parse(raw) as CorrectionRecord[];
    return arr.filter((r) => {
      try { pageSemanticsSchema.parse(r.labels); return true; } catch { return false; }
    });
  } catch { return []; }
}

/** Record (or update) a corrected page; keeps the newest MAX_PER_BRAND records. */
export function saveCorrection(brand: string, rec: Omit<CorrectionRecord, 'correctedAt'>, kv: KV = defaultKV()): void {
  const list = loadCorrections(brand, kv)
    .filter((r) => !(r.fileHash === rec.fileHash && r.pageIndex === rec.pageIndex));
  list.push({ ...rec, correctedAt: new Date().toISOString() });
  list.sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
  kv.set(keyOf(brand), JSON.stringify(list.slice(-MAX_PER_BRAND)));
}

/** The 2 most recently corrected pages for this brand, as few-shot examples. */
export function fewShotFor(brand: string, kv: KV = defaultKV()): FewShotExample[] {
  return loadCorrections(brand, kv)
    .slice(-FEW_SHOT)
    .map((r) => ({ blocks: r.blocks, labels: r.labels }));
}
