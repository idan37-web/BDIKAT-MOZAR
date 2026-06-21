// Stage 7 (C.9): catalog generation surface. Pick a learned TemplateSpec → bind real
// assets (text + images) to its dynamic slots → generate a real DocumentIR that opens
// in the SAME editor. No simulated steps; "create" produces a real, editable artifact.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import type { SlotSpec, TemplateSpec } from '../templates/templateSpec';
import { listTemplates } from '../store/library';
import { generateCatalog, validateCatalog, dynamicSlots, REQUIRED_KINDS, type BindingMap } from '../catalog/generateCatalog';
import { autofitDocument, canvasMeasureFor, type Measure } from '../catalog/autofit';
import { brandFont, ensureFontFace, FALLBACK_HEBREW } from './brandFont';
import { parseSpreadsheetSheets, toCSV } from '../data/parseSheet';
import { sheetToCells, blankTemplateCells, type SheetIssue } from '../data/specSheetFormat';
import { parseToSpecSheet, naturalTemplateSheets } from '../data/workbookAdapter';
import { writeXlsx } from '../data/writeXlsx';
import { sheetStats, emptySheet, type SpecSheet } from '../data/specModel';
import { mapSheetToCatalog, type FieldMapping } from '../data/mapSheetToCatalog';
import { peugeot3008Sheet } from '../data/samples';
import { ensureThumbnails } from './thumbnail';
import { SpecSheetEditor } from './SpecSheetEditor';

const ROLE_HE: Record<string, string> = {
  cover: 'שער', feature: 'עמוד שיווקי', interior: 'עיצוב פנים', colors: 'צבעים',
  wheels: 'חישוקים', safety: 'בטיחות', spec: 'מפרט טכני', price: 'מחיר', back: 'גב/משפטי', content: 'תוכן',
};

/** A plain text measurer bound to one font family (PDF points == CSS px at scale 1). */
function plainMeasure(family: string): Measure {
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = cv?.getContext('2d') || null;
  return (text: string, size: number) => {
    if (!ctx) return text.length * size * 0.5;
    ctx.font = `${size}px ${family}`;
    return ctx.measureText(text).width;
  };
}

function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const downloadCsv = (name: string, cells: string[][]) => downloadBlob(name, new Blob([toCSV(cells)], { type: 'text/csv;charset=utf-8' }));
const downloadXlsx = (name: string, bytes: Uint8Array) => downloadBlob(name, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));

export function GenerateScreen({ initialSpec, onCreate, onBack }: {
  initialSpec?: TemplateSpec | null;
  onCreate: (doc: DocumentIR) => void;
  onBack: () => void;
}) {
  const [saved, setSaved] = React.useState<TemplateSpec[]>([]);
  const [spec, setSpec] = React.useState<TemplateSpec | null>(initialSpec || null);
  React.useEffect(() => {
    listTemplates().then((recs) => {
      const specs = recs.map((r) => r.spec);
      setSaved(specs);
      if (!spec) setSpec(initialSpec || specs[0] || null);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [bindings, setBindings] = React.useState<BindingMap>({});
  const [showMissing, setShowMissing] = React.useState(false);
  // Milestone D — structured data ingestion
  const [sheet, setSheet] = React.useState<SpecSheet | null>(null);
  const [issues, setIssues] = React.useState<SheetIssue[]>([]);
  const [dataErr, setDataErr] = React.useState<string | null>(null);
  const [dataName, setDataName] = React.useState<string>('');
  const [editData, setEditData] = React.useState(false);

  // reset bindings + data when the template changes
  React.useEffect(() => { setBindings({}); setShowMissing(false); setSheet(null); setIssues([]); setDataErr(null); setDataName(''); }, [spec?.id]);

  // mapping report (which fields the sheet populates vs. what stays manual)
  const report = React.useMemo<{ mappings: FieldMapping[]; manual: FieldMapping[]; warnings: string[] } | null>(() => {
    if (!spec || !sheet) return null;
    const { mappings, manual, warnings } = mapSheetToCatalog(spec, sheet, {});
    return { mappings, manual, warnings };
  }, [spec?.id, sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDataFile(file: File) {
    setDataErr(null); setDataName(file.name);
    try {
      const isText = /\.(csv|tsv|txt)$/i.test(file.name);
      const sheets = await parseSpreadsheetSheets(file.name, isText ? await file.text() : await file.arrayBuffer());
      const { sheet: s, issues: iss, format } = parseToSpecSheet(sheets);
      if (!s.sections.length && !s.features.length && !s.colors.length) {
        setDataErr('לא זוהו נתונים בקובץ. תבנית טבעית: גיליון לכל קטגוריה, עמודה A=תווית, B+=ערכים. או הורד תבנית מתויגת.');
        setSheet(null); setIssues(iss); return;
      }
      setSheet(s); setIssues(iss);
      setDataName(`${file.name} · ${format === 'natural' ? 'פורמט גיליונות' : 'פורמט מתויג'}`);
    } catch (e) {
      setDataErr(`קריאת הקובץ נכשלה: ${(e as Error).message}. נסה לשמור כ-CSV (UTF-8).`);
      setSheet(null);
    }
  }

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
  // when a structured sheet supplies the model name, it no longer needs manual entry
  const missing = validateCatalog(spec, bindings).filter((m) => !(sheet?.model && m.kind === 'model-name'));
  const setText = (key: string, text: string) => setBindings((b) => ({ ...b, [key]: { ...b[key], key, text } }));
  const setImage = (key: string, file: File) => {
    const rd = new FileReader();
    rd.onload = () => setBindings((b) => ({ ...b, [key]: { ...b[key], key, imageSrc: String(rd.result) } }));
    rd.readAsDataURL(file);
  };

  function create() {
    if (missing.length) { setShowMissing(true); return; }
    const bf = brandFont(spec!.brand || '');
    if (bf) ensureFontFace(bf);
    const family = bf ? `'${bf.family}', ${FALLBACK_HEBREW}` : FALLBACK_HEBREW;
    // Milestone D: when a structured sheet is loaded, populate spec/feature/colour pages from
    // it (with the manual form supplying images/overrides); otherwise the Stage-7 slot path.
    const doc = sheet
      ? mapSheetToCatalog(spec!, sheet, { bindings, measure: plainMeasure(family), title: 'מפרט טכני' }).doc
      : generateCatalog(spec!, bindings);
    // Milestone B: auto-fit text to its box before opening (shrink→wrap→grow→flag)
    autofitDocument(doc, canvasMeasureFor(family));
    // generated pages have no source raster → render real thumbnails so the rail isn't blank
    ensureThumbnails(doc.pages, family);
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

          {/* Milestone D — structured data ingestion (Excel/CSV → slots) */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 14 }}>נתונים מובנים (Excel / CSV)</strong>
              <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>טען מפרט מובנה → מפרט/אבזור/צבעים ימולאו אוטומטית</span>
              <div style={{ flex: 1 }} />
              <label className="btn btn-sm" style={{ cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px' }}>
                העלה קובץ
                <input type="file" accept=".csv,.tsv,.txt,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadDataFile(f); e.currentTarget.value = ''; }} />
              </label>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSheet(peugeot3008Sheet()); setIssues([]); setDataErr(null); setDataName('פיג׳ו 3008 (דוגמה)'); }}>טען דוגמה אמיתית</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                if (!sheet) { const s = emptySheet(['גרסה 1']); s.sections.push({ title: 'מנוע', rows: [{ label: '', values: [''] }] }); s.features.push({ title: 'בטיחות', items: [{ label: '', perTrim: [true] }] }); setSheet(s); setDataName('הזנה ידנית'); }
                setEditData((v) => !v);
              }}>{editData ? 'סגור עריכה' : '✎ הזנה/עריכה ידנית'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadXlsx('autospec-template.xlsx', writeXlsx(naturalTemplateSheets()))} title="תבנית רב-גיליונות בפורמט שלך">הורד תבנית (Excel)</button>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv('autospec-template.csv', blankTemplateCells())} title="פורמט מתויג חלופי">CSV</button>
              {sheet && <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`${sheet.model || 'spec'}.csv`, sheetToCells(sheet))}>הורד כ-CSV</button>}
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dataErr && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{dataErr}</div>}
              {!sheet && !dataErr && (
                <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  אין נתונים טעונים. העלה קובץ Excel/CSV מובנה, או הורד תבנית למילוי. אפשר גם להמשיך במילוי ידני בלבד (למטה).
                </div>
              )}
              {sheet && (() => {
                const st = sheetStats(sheet);
                return (
                  <>
                    <div style={{ fontSize: 13.5, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                      <span><b>{dataName}</b></span>
                      <span>גרסאות: <b>{st.trims}</b></span>
                      <span>שורות מפרט: <b>{st.rows}</b></span>
                      <span>ערכים: <b>{st.values}</b></span>
                      <span>אבזור: <b>{st.features}</b></span>
                      <span>צבעים: <b>{st.colors}</b></span>
                      <span>חישוקים: <b>{st.wheels}</b></span>
                    </div>
                    {report && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {report.mappings.map((m, i) => (
                          <span key={i} title={m.detail} style={{
                            fontSize: 12, padding: '3px 9px', borderRadius: 999,
                            background: m.status === 'mapped' ? 'rgba(34,160,90,.12)' : 'rgba(220,150,20,.14)',
                            color: m.status === 'mapped' ? '#1d7a44' : '#a4690a',
                            border: `1px solid ${m.status === 'mapped' ? 'rgba(34,160,90,.3)' : 'rgba(220,150,20,.35)'}`,
                          }}>
                            {m.status === 'mapped' ? '✓' : '✎'} {m.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {report && report.manual.length > 0 && (
                      <div style={{ fontSize: 12.5, color: '#a4690a' }}>
                        להשלמה ידנית: {report.manual.map((m) => m.label).join(' · ')} (מלא בטופס למטה)
                      </div>
                    )}
                    {report && report.warnings.length > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{report.warnings.join(' · ')}</div>
                    )}
                    {issues.length > 0 && (
                      <details style={{ fontSize: 12.5 }}>
                        <summary style={{ cursor: 'pointer', color: '#a4690a' }}>{issues.length} שורות לתשומת לב</summary>
                        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                          {issues.slice(0, 20).map((it, i) => <li key={i}>{it.row ? `שורה ${it.row}: ` : ''}{it.message}</li>)}
                        </ul>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          {editData && sheet && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 12, background: 'var(--surface)', padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>הזנת נתונים ידנית — שורות ברורות לפי אזור</div>
              <SpecSheetEditor sheet={sheet} onChange={setSheet} />
            </div>
          )}

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
                          <div style={{ display: 'flex', gap: 6 }}>
                            <label className="btn btn-ghost btn-sm" style={{ flex: 1, cursor: 'pointer', textAlign: 'center', border: isMissing(slot.key) ? '1px solid var(--danger)' : undefined }}>
                              {bindings[slot.key]?.imageSrc ? 'החלף תמונה' : 'בחר תמונה'}
                              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setImage(slot.key, f); }} />
                            </label>
                            {bindings[slot.key]?.imageSrc && (
                              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                                onClick={() => setBindings((b) => ({ ...b, [slot.key]: { ...b[slot.key], key: slot.key, imageSrc: undefined } }))}>הסר</button>
                            )}
                          </div>
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
