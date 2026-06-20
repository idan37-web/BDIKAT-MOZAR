// Stage 7 (C.9): catalog generation surface. Pick a learned TemplateSpec → bind real
// assets (text + images) to its dynamic slots → generate a real DocumentIR that opens
// in the SAME editor. No simulated steps; "create" produces a real, editable artifact.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import type { SlotSpec, TemplateSpec } from '../templates/templateSpec';
import { listTemplates } from '../templates/storage';
import { generateCatalog, validateCatalog, dynamicSlots, REQUIRED_KINDS, type BindingMap } from '../catalog/generateCatalog';
import { autofitDocument, canvasMeasureFor } from '../catalog/autofit';
import { brandFont, ensureFontFace, FALLBACK_HEBREW } from './brandFont';

const ROLE_HE: Record<string, string> = {
  cover: 'שער', feature: 'עמוד שיווקי', interior: 'עיצוב פנים', colors: 'צבעים',
  wheels: 'חישוקים', safety: 'בטיחות', spec: 'מפרט טכני', price: 'מחיר', back: 'גב/משפטי', content: 'תוכן',
};

export function GenerateScreen({ initialSpec, onCreate, onBack }: {
  initialSpec?: TemplateSpec | null;
  onCreate: (doc: DocumentIR) => void;
  onBack: () => void;
}) {
  const saved = React.useMemo(() => listTemplates(), []);
  const [spec, setSpec] = React.useState<TemplateSpec | null>(initialSpec || saved[saved.length - 1] || null);
  const [bindings, setBindings] = React.useState<BindingMap>({});
  const [showMissing, setShowMissing] = React.useState(false);

  // reset bindings when the template changes
  React.useEffect(() => { setBindings({}); setShowMissing(false); }, [spec?.id]);

  if (!spec) {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>יצירת קטלוג</h1>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onBack}>חזרה</button>
        </div>
        <p style={{ color: 'var(--ink-2)', marginTop: 16 }}>אין תבניות שמורות. עבור ל-<b>למידת תבנית</b>, למד תבנית ושמור אותה — ואז אפשר ליצור ממנה קטלוג.</p>
      </div>
    );
  }

  // shape (background/accent) slots auto-fill from the learned design → not in the manual form
  const slots = dynamicSlots(spec).filter((s) => s.slot.blockType !== 'shape');
  const missing = validateCatalog(spec, bindings);
  const setText = (key: string, text: string) => setBindings((b) => ({ ...b, [key]: { ...b[key], key, text } }));
  const setImage = (key: string, file: File) => {
    const rd = new FileReader();
    rd.onload = () => setBindings((b) => ({ ...b, [key]: { ...b[key], key, imageSrc: String(rd.result) } }));
    rd.readAsDataURL(file);
  };

  function create() {
    if (missing.length) { setShowMissing(true); return; }
    const doc = generateCatalog(spec!, bindings);
    // Milestone B: auto-fit text to its box before opening (shrink→wrap→grow→flag)
    const bf = brandFont(spec!.brand || '');
    if (bf) ensureFontFace(bf);
    const family = bf ? `'${bf.family}', ${FALLBACK_HEBREW}` : FALLBACK_HEBREW;
    autofitDocument(doc, canvasMeasureFor(family));
    onCreate(doc);
  }

  const required = (s: SlotSpec) => REQUIRED_KINDS.has(s.kind);
  const isMissing = (key: string) => showMissing && missing.some((m) => m.key === key);

  // group dynamic slots by page
  const byPage = new Map<number, typeof slots>();
  for (const it of slots) {
    const arr = byPage.get(it.pageIndex) || [];
    arr.push(it); byPage.set(it.pageIndex, arr);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <strong style={{ fontFamily: 'var(--display)' }}>יצירת קטלוג</strong>
        <select value={spec.id} onChange={(e) => setSpec(saved.find((t) => t.id === e.target.value) || initialSpec || null)}
          style={{ padding: 6, borderRadius: 8, border: '1px solid var(--line-2)', maxWidth: 320 }}>
          {[...(initialSpec && !saved.some((t) => t.id === initialSpec.id) ? [initialSpec] : []), ...saved].map((t) => (
            <option key={t.id} value={t.id}>{t.brand} · {t.family} · {t.pages.length} עמ׳</option>
          ))}
        </select>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{slots.length} סלוטים דינמיים</span>
        <div style={{ flex: 1 }} />
        {missing.length > 0 && <span style={{ color: 'var(--danger)', fontSize: 13 }}>חסרים {missing.length} שדות חובה</span>}
        <button className="btn btn-sm" onClick={create} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px' }}>צור קטלוג ←</button>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>יציאה</button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: 'rgba(255,255,255,.14)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <p style={{ color: 'var(--ink-2)', fontSize: 14 }}>
            מלא את הסלוטים הדינמיים (כתום) שזוהו בתבנית. שדות חובה מסומנים ב-<b style={{ color: 'var(--danger)' }}>*</b>.
            סלוטים קבועים (טקסט מותג/משפטי) מגיעים מהתבנית אוטומטית. מה שתשאיר ריק יקבל את ערך-הדוגמה שנלמד, וניתן יהיה לערוך הכל בעורך.
          </p>
          {[...byPage.entries()].map(([pageIndex, items]) => {
            const role = items[0]?.role;
            return (
              <div key={pageIndex} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', fontWeight: 800, fontSize: 14 }}>
                  עמוד {pageIndex + 1} · {ROLE_HE[role] || role}
                </div>
                <div style={{ padding: 14, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {items.map(({ slot }) => (
                    <div key={slot.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, display: 'flex', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', alignSelf: 'center' }} />
                        {slot.label}{required(slot) && <span style={{ color: 'var(--danger)' }}>*</span>}
                        <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontFamily: 'var(--mono)' }} dir="ltr">· {slot.kind}</span>
                      </label>
                      {slot.blockType === 'image' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {bindings[slot.key]?.imageSrc && <img src={bindings[slot.key]!.imageSrc} alt="" style={{ width: '100%', maxHeight: 110, objectFit: 'contain', background: 'var(--surface-3)', borderRadius: 8 }} />}
                          <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', textAlign: 'center', border: isMissing(slot.key) ? '1px solid var(--danger)' : undefined }}>
                            {bindings[slot.key]?.imageSrc ? 'החלף תמונה' : 'בחר תמונה'}
                            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setImage(slot.key, f); }} />
                          </label>
                        </div>
                      ) : (
                        <textarea
                          dir={slot.style?.direction === 'ltr' ? 'ltr' : 'rtl'}
                          placeholder={slot.sample || ''}
                          value={bindings[slot.key]?.text ?? ''}
                          onChange={(e) => setText(slot.key, e.target.value)}
                          style={{ width: '100%', minHeight: slot.kind === 'spec-table' ? 96 : 52, padding: 8, borderRadius: 8, border: `1px solid ${isMissing(slot.key) ? 'var(--danger)' : 'var(--line-2)'}`, fontFamily: 'var(--font)', resize: 'vertical' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
