// Semantic layer (contract) — offline unit tests. No network: these lock the CONTRACT itself —
// strict schema validation (the model classifies, never measures), cache keying, correction
// few-shots, table-rescue alignment with the 90% gate, and synthesis-v2 decision rules.
import { describe, it, expect } from 'vitest';
import { parsePageSemantics, parseTableRescue, PAGE_TYPES, BLOCK_ROLES } from '../src/ai/semanticSchema';
import { buildCompactBlocks } from '../src/ai/payload';
import { getCachedSemantics, setCachedSemantics, type KV } from '../src/ai/semanticCache';
import { saveCorrection, fewShotFor, loadCorrections } from '../src/ai/corrections';
import { alignRescuedCells, rescuedToSlotTable, RESCUE_ALIGN_MIN } from '../src/ai/tableRescue';
import { learnTemplateV2, alignPagesByType, ROLE_TO_KIND } from '../src/templates/synthesisV2';
import type { PageSemantics } from '../src/ai/semanticSchema';
import type { DocumentIR, PageIR, TextBlockIR } from '../src/types/catalog';

const memKV = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
};

const tb = (id: string, text: string, x: number, y: number, w = 100, h = 16, over: Partial<TextBlockIR> = {}): TextBlockIR => ({
  id, type: 'text', x, y, width: w, height: h, rotation: 0, zIndex: 1, source: 'original',
  originalBBox: { x, y, width: w, height: h }, text, originalText: text,
  fontFamily: 'f', fontSize: 12, fontWeight: 400, lineHeight: 1.2, color: '#111', direction: 'rtl', align: 'end', ...over,
});
const pg = (id: string, blocks: PageIR['blocks']): PageIR => ({ id, width: 600, height: 400, rotation: 0, blocks });

describe('contract schema — the model classifies, geometry measures', () => {
  const good = JSON.stringify({
    pageType: 'tech_spec',
    blocks: [{ id: 'b1', role: 'spec_table', variability: 'variable', confidence: 0.9, reason: 'numeric grid' }],
  });

  it('accepts a valid response and echoes only known ids', () => {
    const out = parsePageSemantics(good, new Set(['b1']));
    expect(out.pageType).toBe('tech_spec');
    expect(out.blocks[0].role).toBe('spec_table');
  });

  it('REJECTS invented block ids (the model may not create blocks)', () => {
    expect(() => parsePageSemantics(good, new Set(['other']))).toThrow(/invented/);
  });

  it('REJECTS coordinate output (strict schema: no extra keys)', () => {
    const withBbox = JSON.stringify({
      pageType: 'cover',
      blocks: [{ id: 'b1', role: 'hero_image', variability: 'fixed', confidence: 1, reason: 'r', bbox: [0, 0, 5, 5] }],
    });
    expect(() => parsePageSemantics(withBbox, new Set(['b1']))).toThrow();
  });

  it('REJECTS out-of-enum values and clamps reason to 15 words', () => {
    const badRole = good.replace('spec_table', 'not_a_role');
    expect(() => parsePageSemantics(badRole, new Set(['b1']))).toThrow();
    const wordy = JSON.stringify({
      pageType: 'other',
      blocks: [{ id: 'b1', role: 'other', variability: 'fixed', confidence: 0.5, reason: Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ') }],
    });
    const out = parsePageSemantics(wordy, new Set(['b1']));
    expect(out.blocks[0].reason.split(' ').length).toBeLessThanOrEqual(15);
  });

  it('enums match the approved contract exactly', () => {
    expect(PAGE_TYPES).toEqual(['cover', 'model_overview', 'trim_equipment', 'tech_spec', 'safety', 'colors_wheels', 'legal', 'other']);
    expect(BLOCK_ROLES).toEqual(['brand_logo', 'model_name', 'trim_name', 'section_heading', 'hero_image', 'gallery_image', 'spec_table', 'equipment_list', 'price', 'legal_text', 'footnote', 'page_number', 'decorative', 'other']);
  });

  it('table rescue schema is LOGICAL-only (rejects geometry fields)', () => {
    expect(parseTableRescue(JSON.stringify({ headerRows: [0], rows: [['a', 'b']] })).rows[0]).toEqual(['a', 'b']);
    expect(() => parseTableRescue(JSON.stringify({ headerRows: [0], rows: [['a']], bboxes: [[0, 0, 1, 1]] }))).toThrow();
  });
});

describe('compact payload — measured facts only, text truncated', () => {
  it('truncates text to 80 chars and skips gridline shapes', () => {
    const long = 'א'.repeat(200);
    const page = pg('p1', [
      tb('t1', long, 10, 10),
      { id: 's1', type: 'shape', x: 0, y: 0, width: 500, height: 1, rotation: 0, zIndex: 0, source: 'original', originalBBox: { x: 0, y: 0, width: 500, height: 1 } } as never,
      { id: 's2', type: 'shape', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 0, source: 'original', originalBBox: { x: 0, y: 0, width: 100, height: 50 } } as never,
    ]);
    const blocks = buildCompactBlocks(page);
    expect(blocks.find((b) => b.id === 't1')!.text!.length).toBe(80);
    expect(blocks.some((b) => b.id === 's1'), 'thin gridline must be skipped').toBe(false);
    expect(blocks.some((b) => b.id === 's2'), 'panel shape stays').toBe(true);
  });
});

describe('cache — keyed by (fileHash, pageIndex)', () => {
  it('round-trips and isolates keys', () => {
    const kv = memKV();
    const sem: PageSemantics = { pageType: 'cover', blocks: [] };
    setCachedSemantics('hashA', 0, sem, kv);
    expect(getCachedSemantics('hashA', 0, kv)?.pageType).toBe('cover');
    expect(getCachedSemantics('hashA', 1, kv)).toBeNull();
    expect(getCachedSemantics('hashB', 0, kv)).toBeNull();
  });
});

describe('corrections — persisted per brand, last 2 injected as few-shot', () => {
  it('keeps newest, replaces same page, few-shot = 2 most recent', () => {
    const kv = memKV();
    const labels: PageSemantics = { pageType: 'tech_spec', blocks: [{ id: 'x', role: 'spec_table', variability: 'variable', confidence: 1, reason: 'user corrected' }] };
    for (let i = 0; i < 4; i++) saveCorrection('citroen', { fileHash: 'h', pageIndex: i, blocks: [], labels }, kv);
    saveCorrection('citroen', { fileHash: 'h', pageIndex: 1, blocks: [], labels }, kv); // re-correct page 1
    const all = loadCorrections('citroen', kv);
    expect(all.length).toBe(4); // page 1 replaced, not duplicated
    const fs = fewShotFor('citroen', kv);
    expect(fs.length).toBe(2);
    expect(fewShotFor('peugeot', kv).length, 'brand isolation').toBe(0);
  });
});

describe('table rescue — geometry recovered by aligning texts to extracted words', () => {
  const words = [
    tb('w1', 'נפח מנוע', 300, 10, 80),
    tb('w2', '1,199', 200, 10, 40),
    tb('w3', 'משקל', 300, 30, 80),
    tb('w4', '1,151', 200, 30, 40),
    tb('w5', 'כושר', 340, 50, 40),   // two words forming one cell
    tb('w6', 'גרירה', 296, 50, 40),
  ];

  it('aligns exact + concatenated cells and recovers bboxes', () => {
    const rescue = { headerRows: [], rows: [['נפח מנוע', '1,199'], ['משקל', '1,151'], ['כושר גרירה', '']], colspans: [] };
    const a = alignRescuedCells(rescue, words);
    expect(a.rate).toBe(1);
    const cell = a.cells.find((c) => c.text === 'כושר גרירה')!;
    expect(cell.bbox.x).toBe(296); // union of the two word boxes — measured, not model-invented
    expect(cell.bbox.width).toBe(84);
    const t = rescuedToSlotTable(rescue, a, { fontSize: 12, color: '#111', fontFamily: 'f' });
    expect(t.columns).toBe(2);
    expect(t.rows[0].kind).toBe('data');
  });

  it('below-90% alignment fails the gate (keep the text degradation)', () => {
    const rescue = { headerRows: [], rows: [['לא קיים', 'גם לא'], ['משקל', '1,151']] };
    const a = alignRescuedCells(rescue, words);
    expect(a.rate).toBeLessThan(RESCUE_ALIGN_MIN);
  });

  it('containment guard: "44" must not match "1,440"', () => {
    const a = alignRescuedCells({ headerRows: [], rows: [['44']] }, [tb('w9', '1,440', 100, 10, 40)]);
    expect(a.rate).toBe(0);
  });
});

describe('page alignment by type — nth occurrence matching', () => {
  it('maps nth cover↔nth cover and falls back to index', () => {
    const map = alignPagesByType([
      ['cover', 'tech_spec', 'tech_spec', null],
      ['cover', 'legal', 'tech_spec', 'tech_spec'],
    ]);
    expect(map[0][0]).toBe(0); // cover→cover
    expect(map[1][0]).toBe(2); // 1st tech_spec → other doc's 1st tech_spec (index 2)
    expect(map[2][0]).toBe(3); // 2nd tech_spec → other doc's 2nd tech_spec (index 3)
    expect(map[3][0]).toBe(3); // no type → same index fallback
  });
});

describe('synthesis v2 — the contract decision table', () => {
  const sem = (blocks: PageSemantics['blocks'], pageType: PageSemantics['pageType'] = 'tech_spec'): PageSemantics => ({ pageType, blocks });
  const label = (id: string, role: PageSemantics['blocks'][0]['role'], variability: 'fixed' | 'variable', confidence = 0.9) =>
    ({ id, role, variability, confidence, reason: 'r' });

  it('same role + stable bbox + identical content → FIXED; varying content → VARIABLE named by role', () => {
    const docA: DocumentIR = { id: 'a', brand: 'citroen', pages: [pg('p1', [tb('a1', 'נפח מנוע', 300, 10), tb('a2', '1,199', 200, 10, 40)])] };
    const docB: DocumentIR = { id: 'b', brand: 'citroen', pages: [pg('p1', [tb('b1', 'נפח מנוע', 300, 10), tb('b2', '1,598', 200, 10, 40)])] };
    const semantics = [
      [sem([label('a1', 'section_heading', 'fixed'), label('a2', 'spec_table', 'variable')])],
      [sem([label('b1', 'section_heading', 'fixed'), label('b2', 'spec_table', 'variable')])],
    ];
    const spec = learnTemplateV2([docA, docB], semantics);
    const slots = spec.pages[0].slots;
    const labelSlot = slots.find((s) => s.semRole === 'section_heading')!;
    const valueSlot = slots.find((s) => s.semRole === 'spec_table')!;
    expect(labelSlot.dynamic, 'identical content across docs → fixed').toBe(false);
    expect(labelSlot.confidence).toBeGreaterThan(0.85);
    expect(valueSlot.dynamic, 'differing content across docs → variable').toBe(true);
    expect(valueSlot.key).toContain('spec_table'); // slot NAMED AFTER THE ROLE
    expect(spec.pages[0].semType).toBe('tech_spec');
    expect(spec.pages[0].role).toBe('spec'); // contract type → spec role mapping
  });

  it('single sample → model variability flags at REDUCED confidence', () => {
    const doc: DocumentIR = { id: 'a', brand: 'citroen', pages: [pg('p1', [tb('a1', 'PEUGEOT 3008', 200, 10, 200, 40, { fontSize: 40 })])] };
    const spec = learnTemplateV2([doc], [[sem([label('a1', 'model_name', 'variable', 0.95)], 'cover')]]);
    const slot = spec.pages[0].slots[0];
    expect(slot.dynamic).toBe(true);
    expect(slot.confidence, 'single-sample confidence is reduced').toBeLessThanOrEqual(0.6);
    expect(slot.kind).toBe(ROLE_TO_KIND.model_name);
  });

  it('pages without semantics keep the heuristic path (graceful degradation)', () => {
    const doc: DocumentIR = { id: 'a', brand: 'citroen', pages: [pg('p1', [tb('a1', 'שלום עולם', 200, 10)])] };
    const spec = learnTemplateV2([doc], [[null]]);
    expect(spec.pages[0].slots.length).toBeGreaterThan(0);
    expect(spec.pages[0].semType).toBeUndefined();
  });
});
