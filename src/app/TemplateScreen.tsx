// Stage 6 (C.8): template-learning surface. Import one or more same-family PDFs →
// REAL learnTemplate over the IR → review & correct slots (fixed/dynamic, kind,
// label) → save the TemplateSpec as JSON (localStorage + download). No simulation:
// every step runs the real extractor/learner and produces a real artifact.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import { importPdf } from '../pdf/importPdf';
import { learnTemplate, summarizeTemplate, SLOT_LABEL } from '../templates/templateLearning';
import { detectFormat, type SlotKind, type SlotSpec, type TemplateSpec } from '../templates/templateSpec';
import { downloadTemplate } from '../templates/storage';
import { saveTemplate } from '../store/library';
import { blockScreenRect } from '../editor/coords';
import { classifyWithGemini, applyAiToSpec } from '../ai/geminiClassify';
import { getGeminiKey, setGeminiKey } from '../ai/settings';

const SLOT_KINDS: SlotKind[] = [
  'model-name', 'heading', 'marketing-text', 'hero-image', 'image',
  'spec-table', 'safety', 'equipment', 'colors', 'colors-interior', 'wheels', 'pollution', 'price', 'legal', 'logo', 'background', 'text',
];
const ROLE_HE: Record<string, string> = {
  cover: 'שער', feature: 'עמוד שיווקי', interior: 'עיצוב פנים', colors: 'צבעים',
  wheels: 'חישוקים', safety: 'בטיחות', spec: 'מפרט טכני', price: 'מחיר', back: 'גב/משפטי', content: 'תוכן',
};

type Phase = 'pick' | 'learning' | 'review';

export function TemplateScreen({ onBack, onGenerate }: { onBack: () => void; onGenerate?: (spec: TemplateSpec) => void }) {
  const [phase, setPhase] = React.useState<Phase>('pick');
  const [over, setOver] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<DocumentIR[]>([]);
  const [tpl, setTpl] = React.useState<TemplateSpec | null>(null);
  const [curPage, setCurPage] = React.useState(0);
  const [selSlot, setSelSlot] = React.useState<string | null>(null);
  const [selSlots, setSelSlots] = React.useState<Set<string>>(() => new Set());
  const [saved, setSaved] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // optional AI-assist (Gemini)
  const [aiKey, setAiKey] = React.useState('');
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiMsg, setAiMsg] = React.useState<string | null>(null);
  React.useEffect(() => { setAiKey(getGeminiKey()); }, []);

  async function refineWithAi() {
    if (!tpl) return;
    const key = aiKey.trim();
    if (!key) { setAiMsg('הזן מפתח Gemini API (חינמי) כדי להפעיל.'); setAiOpen(true); return; }
    setGeminiKey(key); setAiBusy(true); setAiMsg('שולח לסיווג AI…');
    try {
      const ai = await classifyWithGemini(tpl, key);
      const { spec, stats } = applyAiToSpec(tpl, ai);
      setTpl(spec); setSaved(false); setSelSlot(null); setSelSlots(new Set());
      setAiMsg(`✓ AI עדכן ${stats.pagesChanged} עמודים ו-${stats.slotsChanged} סלוטים. בדוק ותקן לפי הצורך.`);
    } catch (e) {
      setAiMsg(`שגיאת AI: ${(e as Error).message}. ההיוריסטיקה נשמרה.`);
    } finally { setAiBusy(false); }
  }

  async function handleFiles(files: File[]) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) { setErr('בחר קובצי PDF'); return; }
    setErr(null); setPhase('learning'); setLog([]);
    try {
      const imported: DocumentIR[] = [];
      for (const f of pdfs) {
        setLog((l) => [...l, `מייבא ${f.name}…`]);
        const buf = await f.arrayBuffer();
        const doc = await importPdf(buf, f.name, { renderPreviews: true, previewScale: 2 });
        imported.push(doc);
        setLog((l) => [...l, `✓ ${f.name}: ${doc.pages.length} עמ׳ · ${doc.brand}`]);
      }
      // group by page format — a same-brand template family is one format
      const fmt0 = detectFormat(imported[0].pages[0]?.width || 0, imported[0].pages[0]?.height || 1);
      const sameFamily = imported.filter((d) => detectFormat(d.pages[0]?.width || 0, d.pages[0]?.height || 1) === fmt0);
      const skipped = imported.filter((d) => !sameFamily.includes(d));
      if (skipped.length) {
        setLog((l) => [...l, `⚠ פורמט שונה — לא נכללו בלמידה: ${skipped.map((d) => d.sourcePdfName).join(', ')}`]);
      }
      setLog((l) => [...l, `לומד תבנית מ-${sameFamily.length} קבצים (${fmt0})…`]);
      const t = learnTemplate(sameFamily);
      const sum = summarizeTemplate(t);
      setLog((l) => [...l, `✓ נלמדו ${sum.pages} עמ׳ · ${sum.slots} סלוטים (${sum.dynamic} דינמיים / ${sum.fixed} קבועים) · ${sum.crossDoc} בהצלבת מסמכים`]);
      setDocs(sameFamily);
      setTpl(t);
      setCurPage(0);
      setSelSlot(null);
      setSaved(false);
      setPhase('review');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    }
  }

  function patchSlots(ids: Set<string>, patch: Partial<SlotSpec>) {
    setSaved(false);
    setTpl((t) => !t ? t : {
      ...t,
      pages: t.pages.map((p, i) => i !== curPage ? p : {
        ...p,
        slots: p.slots.map((s) => ids.has(s.id) ? { ...s, ...patch } : s),
      }),
    });
  }
  const patchSlot = (slotId: string, patch: Partial<SlotSpec>) => patchSlots(new Set([slotId]), patch);
  function removeSlots(ids: Set<string>) {
    setSaved(false);
    setTpl((t) => !t ? t : {
      ...t,
      pages: t.pages.map((p, i) => i !== curPage ? p : { ...p, slots: p.slots.filter((s) => !ids.has(s.id)) }),
    });
    setSelSlot(null); setSelSlots(new Set());
  }
  const pickSlot = (id: string, additive: boolean) => {
    setSelSlot(id);
    setSelSlots((prev) => {
      if (additive) { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }
      return new Set([id]);
    });
  };

  async function doSave() {
    if (!tpl) return;
    await saveTemplate(tpl, docs[0]?.pages[0]?.previewImage);
    setSaved(true);
  }

  // ---- PICK / LEARNING ----
  if (phase !== 'review' || !tpl) {
    const busy = phase === 'learning';
    return (
      <div style={{ maxWidth: 760, margin: '40px auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>למידת תבנית</h1>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onBack}>חזרה</button>
        </div>
        <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>
          גרור קובץ PDF אחד או יותר מאותו מותג/משפחה (למשל 3008 + 5008). המערכת מחלצת IR אמיתי, מזהה תפקידי עמוד
          וסלוטים, ומכריעה <b>קבוע מול דינמי</b> מתוך השוואה אמיתית בין הקבצים.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) handleFiles(Array.from(e.dataTransfer.files || [])); }}
          onClick={() => !busy && inputRef.current?.click()}
          style={{
            marginTop: 22, minHeight: 220, borderRadius: 16, cursor: busy ? 'default' : 'pointer',
            border: `2px dashed ${over ? 'var(--accent)' : 'var(--line-2)'}`,
            background: over ? 'var(--accent-soft)' : 'var(--surface)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>{busy ? 'לומד…' : 'גרור PDF (אחד או יותר)'}</div>
          <div style={{ color: 'var(--ink-3)' }}>{busy ? '' : 'או לחץ לבחירת קבצים'}</div>
          <input ref={inputRef} type="file" accept="application/pdf" multiple hidden
            onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) handleFiles(fs); }} />
          {log.length > 0 && (
            <div dir="rtl" style={{ width: '100%', marginTop: 8, fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--mono)', textAlign: 'start', maxHeight: 160, overflow: 'auto' }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        </div>
      </div>
    );
  }

  // ---- REVIEW ----
  const page = tpl.pages[curPage];
  const preview = docs[0]?.pages[page.index]?.previewImage;
  const sel = page.slots.find((s) => s.id === selSlot) || null;
  const sum = summarizeTemplate(tpl);
  const displayW = Math.min(720, page.width);
  const scale = displayW / page.width;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <strong style={{ fontFamily: 'var(--display)' }}>למידת תבנית</strong>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>
          {tpl.brand} · {tpl.format} · {sum.pages} עמ׳ · {sum.dynamic} דינמי / {sum.fixed} קבוע · נלמד מ-{tpl.learnedFrom.length} קבצים
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={refineWithAi} disabled={aiBusy} title="סיווג עמודים/סלוטים בעזרת Gemini (אופציונלי)">{aiBusy ? 'AI…' : '✨ שפר עם AI'}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setAiOpen((v) => !v)} title="הגדרות AI">⚙</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate(tpl)}>הורד JSON</button>
        <button className="btn btn-sm" onClick={doSave} style={{ background: saved ? 'var(--ok, #0a7d3b)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px' }}>
          {saved ? '✓ נשמר' : 'שמור תבנית'}
        </button>
        {onGenerate && <button className="btn btn-sm" onClick={async () => { await saveTemplate(tpl, docs[0]?.pages[0]?.previewImage); onGenerate(tpl); }} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px' }}>צור קטלוג ←</button>}
        <button className="btn btn-ghost btn-sm" onClick={onBack}>יציאה</button>
      </header>

      {(aiOpen || aiMsg) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', flexWrap: 'wrap' }}>
          {aiOpen && (
            <>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Gemini API key:</span>
              <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="מפתח חינמי מ-aistudio.google.com" dir="ltr"
                style={{ flex: 1, minWidth: 220, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)', fontFamily: 'var(--mono)' }} />
              <button className="btn btn-sm" onClick={() => { setGeminiKey(aiKey); setAiMsg('✓ המפתח נשמר במכשיר זה.'); }} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px' }}>שמור מפתח</button>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>נשמר מקומית בדפדפן; נשלח רק ל-Google בעת "שפר עם AI".</span>
            </>
          )}
          {aiMsg && <span style={{ fontSize: 12.5, color: aiMsg.startsWith('שגיאת') ? 'var(--danger)' : 'var(--ink-2)' }}>{aiMsg}</span>}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* page rail */}
        <div style={{ width: 132, flexShrink: 0, overflowY: 'auto', padding: 10, borderInlineEnd: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          {tpl.pages.map((p, i) => (
            <button key={i} onClick={() => { setCurPage(i); setSelSlot(null); setSelSlots(new Set()); }}
              style={{ display: 'block', width: '100%', marginBottom: 8, cursor: 'pointer', textAlign: 'start', border: i === curPage ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
              {docs[0]?.pages[p.index]?.previewImage && <img src={docs[0].pages[p.index].previewImage} alt="" style={{ width: '100%', display: 'block' }} />}
              <div style={{ fontSize: 10, padding: '3px 5px', color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{i + 1} · {ROLE_HE[p.role] || p.role}</span><span>{p.slots.length}</span>
              </div>
            </button>
          ))}
        </div>

        {/* page + slot overlays */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, background: 'rgba(255,255,255,.14)' }}>
          <div style={{ position: 'relative', width: displayW, height: page.height * scale, background: '#fff', boxShadow: '0 2px 18px rgba(0,0,0,.18)' }}>
            {preview && <img src={preview} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }} />}
            {page.slots.map((s) => {
              const r = blockScreenRect(s.bbox, scale);
              const inMulti = selSlots.has(s.id);
              const on = s.id === selSlot || inMulti;
              const c = s.ignored ? '#b00' : s.dynamic ? 'var(--accent)' : '#7b8088';
              return (
                <button key={s.id} onClick={(e) => pickSlot(s.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                  title={`${s.label} · ${s.ignored ? 'מוסתר' : s.dynamic ? 'דינמי' : 'קבוע'}`}
                  style={{
                    position: 'absolute', left: r.left, top: r.top, width: Math.max(6, r.width), height: Math.max(6, r.height),
                    border: `${on ? 2 : 1.5}px ${s.ignored ? 'dashed' : 'solid'} ${c}`,
                    background: s.ignored ? 'rgba(160,0,0,.06)' : s.dynamic ? 'rgba(232,120,30,.14)' : 'rgba(123,128,136,.12)',
                    borderRadius: 3, cursor: 'pointer', padding: 0, boxShadow: on ? `0 0 0 2px ${c}55` : 'none',
                    opacity: s.ignored ? 0.5 : 1,
                  }}>
                  <span style={{ position: 'absolute', top: -1, insetInlineEnd: 1, fontSize: 9, lineHeight: '11px', padding: '0 2px', background: c, color: '#fff', borderRadius: 2, whiteSpace: 'nowrap', textDecoration: s.ignored ? 'line-through' : 'none' }}>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* slot editor */}
        <div style={{ width: 290, flexShrink: 0, borderInlineStart: '1px solid var(--line)', background: 'var(--surface-2)', padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 10 }}>
            עמוד {curPage + 1} · <b>{ROLE_HE[page.role] || page.role}</b>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{page.roleEvidence.join(' · ')}</div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => { const ids = page.slots.map((s) => s.id); setSelSlots(new Set(ids)); setSelSlot(ids[ids.length - 1] || null); }}>בחר את כל הסלוטים בעמוד</button>
          </div>
          {selSlots.size > 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontWeight: 800 }}>{selSlots.size} סלוטים נבחרו</div>
              <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: 0 }}>Shift/⌘-קליק מוסיף/מסיר. פעולה תחול על כולם.</p>
              <label style={{ fontSize: 12, fontWeight: 700 }}>שנה סוג לכולם
                <select defaultValue="" onChange={(e) => { const k = e.target.value as SlotKind; if (k) patchSlots(selSlots, { kind: k, label: SLOT_LABEL[k] }); }}
                  style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }}>
                  <option value="">— בחר סוג —</option>
                  {SLOT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <div className="seg">
                <button onClick={() => patchSlots(selSlots, { dynamic: true, fixedContent: undefined })} style={{ flex: 1, fontSize: 12 }}>דינמי</button>
                <button onClick={() => patchSlots(selSlots, { dynamic: false })} style={{ flex: 1, fontSize: 12 }}>קבוע</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => patchSlots(selSlots, { ignored: true })}>התעלם מכולם</button>
              <button className="btn btn-ghost btn-sm" onClick={() => patchSlots(selSlots, { ignored: false })}>בטל התעלמות</button>
              <button className="btn btn-ghost btn-sm" onClick={() => removeSlots(selSlots)} style={{ color: 'var(--danger)' }}>מחק {selSlots.size} סלוטים</button>
            </div>
          ) : !sel ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>בחר סלוט (מלבן) כדי לתקן את הסיווג. Shift/⌘-קליק לבחירה מרובה. כתום=דינמי · אפור=קבוע · אדום מקווקו=מוסתר.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>סלוט</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>קבוע / דינמי</div>
                <div className="seg">
                  <button className={sel.dynamic ? 'on' : ''} onClick={() => patchSlot(sel.id, { dynamic: true, fixedContent: undefined })} style={{ flex: 1, fontSize: 12 }}>דינמי</button>
                  <button className={!sel.dynamic ? 'on' : ''} onClick={() => patchSlot(sel.id, { dynamic: false, fixedContent: sel.blockType === 'text' ? (sel.sample || '') : undefined })} style={{ flex: 1, fontSize: 12 }}>קבוע</button>
                </div>
              </div>
              <label style={{ fontSize: 12, fontWeight: 700 }}>סוג הסלוט
                <select value={sel.kind} onChange={(e) => { const k = e.target.value as SlotKind; patchSlot(sel.id, { kind: k, label: SLOT_LABEL[k] }); }}
                  style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }}>
                  {SLOT_KINDS.map((k) => <option key={k} value={k}>{k} · {SLOT_LABEL[k]}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, fontWeight: 700 }}>תווית
                <input value={sel.label} onChange={(e) => patchSlot(sel.id, { label: e.target.value })}
                  style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, color: sel.ignored ? 'var(--accent)' : '#b00' }} onClick={() => patchSlot(sel.id, { ignored: !sel.ignored })}>
                  {sel.ignored ? '↺ בטל התעלמות' : '⊘ התעלם מסלוט'}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeSlots(new Set([sel.id]))}>מחק</button>
              </div>
              {sel.ignored && <div style={{ fontSize: 11.5, color: '#b00' }}>הסלוט מוסתר — לא ייכלל בקטלוג שייווצר.</div>}
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }} dir="ltr">
                {sel.blockType} · conf {sel.confidence} · {sel.variants} variant(s) · {sel.crossDocEvidence ? 'cross-doc' : 'single-doc'}
              </div>
              {sel.sample && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>דוגמה {sel.blockType === 'image' ? '(תמונה)' : ''}</div>
                  {sel.blockType === 'image'
                    ? <img src={sel.sample} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--surface-3)', borderRadius: 8 }} />
                    : <div dir="rtl" style={{ fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>{sel.sample}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
