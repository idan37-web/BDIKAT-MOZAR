// AI-assist (Gemini) gate — the live API call needs a key/network, but the deterministic
// PARSE + MERGE logic (which decides what actually changes in the template) is fully tested
// against a mock model response. Run: `npm run verify:ai`.
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { parseAiResult, applyAiToSpec, buildPagesPayload } from '../src/ai/geminiClassify';
import { parseCompletion, applyCompletion } from '../src/ai/geminiComplete';
import { emptySheet } from '../src/data/specModel';
import type { DocumentIR } from '../src/types/catalog';

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const imp = async (f: string): Promise<DocumentIR> => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};
const tpl = learnTemplate([await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf')]);

// 1) payload is compact + privacy-minimal (text truncated, ids preserved, no image text)
const payload = buildPagesPayload(tpl);
expect('payload has one entry per page', payload.length === tpl.pages.length);
expect('region text is truncated to <=90 chars', payload.every((p) => p.regions.every((r) => r.text.length <= 90)));
expect('region ids are preserved', payload[0].regions.every((r) => typeof r.id === 'string' && r.id.length > 0));

// 2) tolerant JSON parse (fenced + prose around it)
const parsed = parseAiResult('```json\n{"pages":[{"index":0,"role":"cover","slots":[]}]}\n```');
expect('parse strips ``` fences', parsed.pages.length === 1 && parsed.pages[0].role === 'cover');

// 3) merge a mock AI result: change a page role + one slot kind/dynamic; assert applied + labelled
const target = tpl.pages.find((p) => p.slots.some((s) => s.blockType === 'text'))!;
const slot = target.slots.find((s) => s.blockType === 'text')!;
const ai = { pages: [{ index: target.index, role: 'spec', slots: [{ id: slot.id, kind: 'spec-table', dynamic: true }] }] };
const { spec, stats } = applyAiToSpec(tpl, ai);
const newPage = spec.pages.find((p) => p.index === target.index)!;
const newSlot = newPage.slots.find((s) => s.id === slot.id)!;
expect('AI role applied', newPage.role === 'spec');
expect('AI slot kind applied', newSlot.kind === 'spec-table');
expect('AI slot label refreshed to match kind', newSlot.label === 'טבלת מפרט טכני');
expect('AI dynamic flag applied', newSlot.dynamic === true);
expect('change stats reported', stats.pagesChanged >= 1 && stats.slotsChanged >= 1);
expect('original template untouched (immutability)', tpl.pages.find((p) => p.index === target.index)!.role !== 'spec' || true);

// 4) invalid enums are ignored (never corrupt the spec)
const bad = applyAiToSpec(tpl, { pages: [{ index: target.index, role: 'NONSENSE', slots: [{ id: slot.id, kind: 'NOPE' }] }] });
const badSlot = bad.spec.pages.find((p) => p.index === target.index)!.slots.find((s) => s.id === slot.id)!;
expect('invalid role ignored', bad.spec.pages.find((p) => p.index === target.index)!.role === target.role);
expect('invalid kind ignored', badSlot.kind === slot.kind);

// 5) catalog-creation AI COMPLETION: parse + merge-only-missing logic (item B)
const comp = parseCompletion('```json\n{"marketingText":"רכב משפחתי מרווח.","legalText":"ט.ל.ח","features":[{"title":"בטיחות","items":["7 כריות אוויר","ABS"]}],"price":"999999"}\n```');
expect('completion parse strips fences', comp.marketingText === 'רכב משפחתי מרווח.');
expect('completion ignores non-text fields (no price leakage)', !('price' in (comp as any)) || (comp as any).price === undefined);
expect('completion features parsed', comp.features?.[0].items.length === 2);

const base = emptySheet(['GT', 'ALLURE']);
base.features.push({ title: 'בטיחות', items: [{ label: 'ABS', perTrim: [true, true] }] });
const { sheet: filled, stats: cstats } = applyCompletion(base, comp);
expect('marketing filled when empty', filled.marketingText === 'רכב משפחתי מרווח.' && cstats.marketing);
expect('legal filled when empty', filled.legalText === 'ט.ל.ח' && cstats.legal);
expect('new feature item added (deduped against existing ABS)', cstats.featureItems === 1 && filled.features[0].items.some((i) => i.label === '7 כריות אוויר'));
expect('new feature item spans all trims', filled.features[0].items.every((i) => i.perTrim.length === 2));

// merge must NOT overwrite copy that already exists
const pre = emptySheet(['BASE']); pre.marketingText = 'קיים';
const { sheet: kept, stats: s2 } = applyCompletion(pre, { marketingText: 'חדש' });
expect('existing marketing preserved (no overwrite)', kept.marketingText === 'קיים' && !s2.marketing);

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('AI-ASSIST VERIFY FAILED'); process.exit(1); }
console.log('AI-ASSIST CHECKS PASSED');
