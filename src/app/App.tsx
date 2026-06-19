// New structured-model app. Stage 2: import. Stage 3: IR-as-truth editor with a
// textarea overlay and Original/Editable/Reconstructed/Compare view modes.
import React from 'react';
import type { DocumentIR, TextBlockIR, ImageBlockIR, BlockIR } from '../types/catalog';
import { ImportScreen } from './ImportScreen';
import { TemplateScreen } from './TemplateScreen';
import { PageView, type ViewMode } from './PageView';
import { brandFont, ensureFontFace, FALLBACK_HEBREW } from './brandFont';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'original', label: 'מקור' },
  { id: 'editable', label: 'עריכה' },
  { id: 'reconstructed', label: 'משוחזר' },
  { id: 'compare', label: 'השוואה' },
];

export function App() {
  const [doc, setDoc] = React.useState<DocumentIR | null>(null);
  const [learning, setLearning] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [mode, setMode] = React.useState<ViewMode>('editable');
  const [sel, setSel] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);

  const bf = doc ? brandFont(doc.brand || '') : null;
  React.useEffect(() => { if (bf) ensureFontFace(bf); }, [bf]);

  if (learning) return <TemplateScreen onBack={() => setLearning(false)} />;
  if (!doc) return <ImportScreen onImported={(d) => { setDoc(d); setCur(0); setSel(null); setEditing(null); }} onLearnTemplate={() => setLearning(true)} />;

  const page = doc.pages[cur];
  const scale = Math.min(1, 880 / page.width);
  const brandFamily = bf ? `'${bf.family}', ${FALLBACK_HEBREW}` : FALLBACK_HEBREW;
  const selAny = page.blocks.find((b) => b.id === sel);
  const selBlock = selAny?.type === 'text' ? (selAny as TextBlockIR) : undefined;
  const selImage = selAny?.type === 'image' ? (selAny as ImageBlockIR) : undefined;

  const patchBlock = (id: string, patch: Partial<BlockIR> & Record<string, unknown>) => {
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : {
        ...p,
        blocks: p.blocks.map((b) => b.id === id ? { ...b, ...patch, dirty: true } : b),
      }),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <strong style={{ fontFamily: 'var(--display)' }}>AutoSpec Studio</strong>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{doc.sourcePdfName} · {doc.pages.length} עמ׳</span>
        <div className="seg" style={{ marginInlineStart: 10 }}>
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => { setMode(m.id); setEditing(null); }} style={{ fontSize: 12 }}>{m.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setDoc(null)}>ייבוא אחר</button>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* page rail */}
        <div style={{ width: 116, flexShrink: 0, overflowY: 'auto', padding: 10, borderInlineEnd: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          {doc.pages.map((p, i) => (
            <button key={p.id} onClick={() => { setCur(i); setSel(null); setEditing(null); }}
              style={{ display: 'block', width: '100%', marginBottom: 8, cursor: 'pointer', border: i === cur ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', background: '#fff', aspectRatio: `${p.width}/${p.height}` }}>
              {p.previewImage && <img src={p.previewImage} alt="" style={{ width: '100%', display: 'block' }} />}
            </button>
          ))}
        </div>

        {/* canvas */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 28, background: 'rgba(255,255,255,.14)' }}>
          <PageView
            page={page} scale={scale} mode={mode} fontFamily={brandFamily}
            selectedId={sel} editingId={editing}
            onSelect={(id) => { setSel(id); if (editing && editing !== id) setEditing(null); }}
            onStartEdit={(id) => { setSel(id); setEditing(id); }}
            onChangeText={(id, text) => patchBlock(id, { text })}
            onResize={(id, box) => patchBlock(id, box)}
            onCommit={() => setEditing(null)}
          />
        </div>

        {/* properties */}
        <div style={{ width: 264, flexShrink: 0, borderInlineStart: '1px solid var(--line)', background: 'var(--surface-2)', padding: 16, overflowY: 'auto' }}>
          {mode !== 'editable' ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>עבור למצב <b>עריכה</b> כדי לבחור ולערוך. קליק=בחירה · גרירה=הזזה · דאבל-קליק=עריכת טקסט · פינות=שינוי גודל.</p>
          ) : selImage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>תמונה</div>
              <img src={selImage.src} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--surface-3)', borderRadius: 8 }} />
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
                החלף תמונה
                <input type="file" accept="image/*" hidden onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const rd = new FileReader();
                  rd.onload = () => patchBlock(selImage.id, { src: String(rd.result) });
                  rd.readAsDataURL(f);
                }} />
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>התאמה למסגרת</div>
                <div className="seg">
                  {(['cover', 'contain', 'fill'] as const).map((fmode) => (
                    <button key={fmode} className={(selImage.fit || 'cover') === fmode ? 'on' : ''} onClick={() => patchBlock(selImage.id, { fit: fmode })} style={{ flex: 1, fontSize: 12 }}>
                      {fmode === 'cover' ? 'מילוי' : fmode === 'contain' ? 'הכל' : 'מתיחה'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>רוחב
                  <input type="number" value={Math.round(selImage.width)} onChange={(e) => patchBlock(selImage.id, { width: +e.target.value })} style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>גובה
                  <input type="number" value={Math.round(selImage.height)} onChange={(e) => patchBlock(selImage.id, { height: +e.target.value })} style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </label>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { const o = selImage.originalBBox; patchBlock(selImage.id, { src: selImage.originalImageRef || selImage.src, fit: 'cover', ...(o ? { x: o.x, y: o.y, width: o.width, height: o.height } : {}) }); }}>איפוס</button>
            </div>
          ) : !selBlock ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>בחר אלמנט (קליק) — טקסט או תמונה. דאבל-קליק על טקסט לעריכה.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>תיבת טקסט</div>
              <label style={{ fontSize: 12, fontWeight: 700 }}>טקסט
                <textarea value={selBlock.text} dir="rtl" onChange={(e) => patchBlock(selBlock.id, { text: e.target.value })}
                  style={{ width: '100%', minHeight: 64, marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--line-2)', fontFamily: 'var(--font)' }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 700 }}>גודל גופן: {Math.round(selBlock.fontSize)}
                <input type="range" min={6} max={90} value={selBlock.fontSize} onChange={(e) => patchBlock(selBlock.id, { fontSize: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              {/* weight + alignment */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => patchBlock(selBlock.id, { fontWeight: selBlock.fontWeight >= 700 ? 400 : 700 })}
                  className={selBlock.fontWeight >= 700 ? 'on' : ''}
                  style={{ width: 44, fontWeight: 800, border: '1px solid var(--line-2)', borderRadius: 8, background: selBlock.fontWeight >= 700 ? 'var(--accent-soft)' : 'var(--surface)', color: selBlock.fontWeight >= 700 ? 'var(--accent-ink)' : 'var(--ink)' }}>B</button>
                <div className="seg" style={{ flex: 1 }}>
                  {(['start', 'center', 'end'] as const).map((a) => (
                    <button key={a} className={selBlock.align === a ? 'on' : ''} onClick={() => patchBlock(selBlock.id, { align: a })} style={{ flex: 1, fontSize: 12 }}>{a === 'start' ? 'ימין' : a === 'center' ? 'מרכז' : 'שמאל'}</button>
                  ))}
                </div>
              </div>
              {/* colour */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>צבע</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  {['#111418', '#ffffff', '#52555c', '#1b4fa0', '#c0142d', '#0a7d3b'].map((c) => (
                    <button key={c} onClick={() => patchBlock(selBlock.id, { color: c })} title={c}
                      style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: selBlock.color.toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                  ))}
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(selBlock.color) ? selBlock.color : '#111418'}
                    onChange={(e) => patchBlock(selBlock.id, { color: e.target.value })}
                    style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                </div>
              </div>
              {/* line height */}
              <label style={{ fontSize: 12, fontWeight: 700 }}>ריווח שורות: {selBlock.lineHeight.toFixed(2)}
                <input type="range" min={0.8} max={2.4} step={0.05} value={selBlock.lineHeight} onChange={(e) => patchBlock(selBlock.id, { lineHeight: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>רוחב
                  <input type="number" value={Math.round(selBlock.width)} onChange={(e) => patchBlock(selBlock.id, { width: +e.target.value })} style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>גובה
                  <input type="number" value={Math.round(selBlock.height)} onChange={(e) => patchBlock(selBlock.id, { height: +e.target.value })} style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </label>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }} dir="ltr">
                x{Math.round(selBlock.x)} y{Math.round(selBlock.y)} · {selBlock.direction} · {selBlock.dirty ? 'edited' : 'original'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
