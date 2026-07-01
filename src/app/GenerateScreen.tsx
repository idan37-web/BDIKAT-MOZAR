// Stage 7 (C.9): catalog generation surface. Pick a learned TemplateSpec → bind real
// assets (text + images) to its dynamic slots → generate a real DocumentIR that opens
// in the SAME editor. No simulated steps; "create" produces a real, editable artifact.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import type { SlotSpec, TemplateSpec } from '../templates/templateSpec';
import { listTemplates } from '../store/library';
import { generateCatalog, validateCatalog, dynamicSlots, applyBrandLogos, REQUIRED_KINDS, type BindingMap } from '../catalog/generateCatalog';
import { loadBrandLogoDataUrl } from './brandLogo';
import { autofitDocument, canvasMeasureFor, fitTableBlock, type Measure } from '../catalog/autofit';
import { brandFont, ensureFontFace, FALLBACK_HEBREW } from './brandFont';
import { parseSpreadsheetSheets, toCSV } from '../data/parseSheet';
import { sheetToCells, blankTemplateCells, type SheetIssue } from '../data/specSheetFormat';
import { parseToSpecSheet, naturalTemplateSheets, DRIVE_LABELS, type DriveType } from '../data/workbookAdapter';
import { writeXlsx } from '../data/writeXlsx';
import { sheetStats, emptySheet, type SpecSheet } from '../data/specModel';
import { mapSheetToCatalog, type FieldMapping } from '../data/mapSheetToCatalog';
import { peugeot3008Sheet } from '../data/samples';
import { ensureThumbnails } from './thumbnail';
import { SpecSheetEditor } from './SpecSheetEditor';
import { PageView } from './PageView';
import { completeSheetWithGemini, applyCompletion, COMPLETE_DEFAULT_MODEL } from '../ai/geminiComplete';
import { GEMINI_MODELS } from '../ai/models';
import { getGeminiKey, setGeminiKey } from '../ai/settings';
import { extractPdfText } from '../pdf/pdfText';

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

/** Does the sheet carry real data (vs. an empty starter)? Only then drive generation from it. */
function sheetHasData(s: SpecSheet | null): boolean {
  return !!s && (
    sheetStats(s).values > 0 || s.colors.length > 0 || !!s.marketingText || !!s.price ||
    s.sections.some((sec) => sec.rows.some((r) => r.label.trim())) ||
    s.features.some((c) => c.items.some((it) => it.label.trim()))
  );
}

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
  const [editData, setEditData] = React.useState(true);
  const [drive, setDrive] = React.useState<DriveType>('phev');
  // AI completion of missing copy (item B)
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiKey, setAiKey] = React.useState(getGeminiKey());
  const [aiModel, setAiModel] = React.useState(COMPLETE_DEFAULT_MODEL);
  const [aiSource, setAiSource] = React.useState('');
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiMsg, setAiMsg] = React.useState<string | null>(null);
  // live preview of the generated catalog (item E)
  const [preview, setPreview] = React.useState<DocumentIR | null>(null);
  // brand logo (data URL) preloaded so generation can drop it into detected "logo" slots
  const [logoData, setLogoData] = React.useState<string | undefined>(undefined);
  React.useEffect(() => { loadBrandLogoDataUrl(spec?.brand).then(setLogoData).catch(() => setLogoData(undefined)); }, [spec?.brand]);
  // On template (spec) change: reset bindings/data, then seed a starter sheet so the row-based
  // editor is the primary view. (Single effect — a separate reset effect used to clobber the seed.)
  React.useEffect(() => {
    setBindings({}); setShowMissing(false); setIssues([]); setDataErr(null);
    if (spec && editData) {
      const s = emptySheet(['גרסה 1', 'גרסה 2']);
      s.sections.push({ title: 'מנוע', rows: [{ label: '', values: ['', ''] }] });
      s.features.push({ title: 'בטיחות', items: [{ label: '', perTrim: [true, true] }] });
      setSheet(s); setDataName('הזנה ידנית');
    } else { setSheet(null); setDataName(''); }
  }, [spec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // mapping report (which fields the sheet populates vs. what stays manual)
  const report = React.useMemo<{ mappings: FieldMapping[]; manual: FieldMapping[]; warnings: string[] } | null>(() => {
    if (!spec || !sheetHasData(sheet)) return null;
    const { mappings, manual, warnings } = mapSheetToCatalog(spec, sheet!, {});
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

  // brand font family for measuring/rendering the generated doc
  const genFamily = () => {
    const bf = brandFont(spec!.brand || '');
    if (bf) ensureFontFace(bf);
    return bf ? `'${bf.family}', ${FALLBACK_HEBREW}` : FALLBACK_HEBREW;
  };

  /** Build the real DocumentIR from the current template + sheet/bindings (shared by create + preview). */
  function buildDoc(): DocumentIR {
    const family = genFamily();
    // Milestone D: when a structured sheet is loaded, populate spec/feature/colour pages from
    // it (with the manual form supplying images/overrides); otherwise the Stage-7 slot path.
    const doc = sheetHasData(sheet)
      ? mapSheetToCatalog(spec!, sheet!, { bindings, measure: plainMeasure(family), title: 'מפרט טכני' }).doc
      : generateCatalog(spec!, bindings);
    // drop the brand logo into every detected "logo" slot (item: auto-embed brand logos)
    applyBrandLogos(doc, spec!, logoData);
    // Milestone B: auto-fit text to its box before opening (shrink→wrap→grow→flag)
    autofitDocument(doc, canvasMeasureFor(family));
    // fit every generated TABLE too, so no cell opens clipped (same logic as the editor button)
    const cv = document.createElement('canvas'); const cctx = cv.getContext('2d');
    const cellMeasure = (text: string, size: number, bold: boolean) => {
      if (!cctx) return text.length * size * 0.5;
      cctx.font = `${bold ? 700 : 400} ${size}px ${family}`;
      return cctx.measureText(text).width;
    };
    for (const p of doc.pages) for (const b of p.blocks) if (b.type === 'table') fitTableBlock(b as import('../types/catalog').TableBlockIR, cellMeasure);
    // generated pages have no source raster → render real thumbnails so the rail isn't blank
    ensureThumbnails(doc.pages, family);
    return doc;
  }

  function create() {
    if (missing.length) { setShowMissing(true); return; }
    onCreate(buildDoc());
  }

  function openPreview() {
    if (!spec) return;
    try { setPreview(buildDoc()); }
    catch (e) { setDataErr(`תצוגה מקדימה נכשלה: ${(e as Error).message}`); }
  }

  // run AI completion of the missing copy from pasted/uploaded source material
  async function runAiComplete() {
    if (!aiKey.trim()) { setAiMsg('הזן מפתח Gemini (חינמי מ-aistudio.google.com).'); setAiOpen(true); return; }
    if (!aiSource.trim()) { setAiMsg('הדבק טקסט או קישור לעמוד הדגם (או טען PDF) לפני ההשלמה.'); return; }
    // self-heal: if no sheet is loaded yet, seed an empty one so completion has a target
    const base = sheet ?? emptySheet(['גרסה 1', 'גרסה 2']);
    // collect the EMPTY marketing/heading text regions of the first catalog pages, so the AI
    // writes copy for ALL of them (not just the single sheet marketingText field).
    const COPY_KINDS = new Set(['marketing-text', 'heading', 'model-name', 'text']);
    const copySlots = spec
      ? dynamicSlots(spec)
          .filter((d) => d.slot.blockType === 'text' && COPY_KINDS.has(d.slot.kind))
          .filter((d) => !(bindings[d.slot.key]?.text && bindings[d.slot.key]!.text!.trim()))
          .sort((a, b) => a.pageIndex - b.pageIndex)
          .slice(0, 16)
          .map((d) => {
            const fs = d.slot.style?.fontSize || 12;
            const cap = Math.round((d.slot.bbox.width * d.slot.bbox.height) / (fs * fs) * 1.5);
            return { key: d.slot.key, kind: d.slot.kind, page: d.pageIndex, sample: (d.slot.sample || '').slice(0, 160), maxChars: Math.max(20, Math.min(600, cap)) };
          })
      : [];
    setAiBusy(true); setAiMsg('פונה ל-Gemini…');
    try {
      setGeminiKey(aiKey);
      const c = await completeSheetWithGemini(base, aiSource, aiKey, aiModel, copySlots);
      const { sheet: merged, stats } = applyCompletion(base, c);
      setSheet(merged);
      // apply per-slot copy into the bindings (only for slots still empty)
      let slotsFilled = 0;
      if (c.slotFills?.length) {
        const valid = new Set(copySlots.map((s) => s.key));
        setBindings((b) => {
          const next = { ...b };
          for (const f of c.slotFills!) {
            if (!valid.has(f.key)) continue;
            if (next[f.key]?.text && next[f.key]!.text!.trim()) continue;
            next[f.key] = { ...next[f.key], key: f.key, text: f.text };
            slotsFilled++;
          }
          return next;
        });
      }
      const parts: string[] = [];
      if (slotsFilled) parts.push(`${slotsFilled} אזורי טקסט בעמודים`);
      if (stats.marketing) parts.push('טקסט שיווקי (גיליון)');
      if (stats.legal) parts.push('טקסט משפטי');
      if (stats.featureItems) parts.push(`${stats.featureItems} שורות אבזור`);
      setAiMsg(parts.length ? `✓ הושלמו: ${parts.join(', ')}.` : 'ה-AI לא מצא תוכן ודאי להוסיף (אולי הכל כבר מלא).');
    } catch (e) {
      setAiMsg(`שגיאת AI: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function loadAiSourcePdf(file: File) {
    setAiMsg('מחלץ טקסט מה-PDF…');
    try { const txt = await extractPdfText(await file.arrayBuffer()); setAiSource((s) => (s ? s + '\n\n' : '') + txt); setAiMsg(`✓ נטען טקסט מ-${file.name} (${txt.length} תווים).`); }
    catch (e) { setAiMsg(`קריאת ה-PDF נכשלה: ${(e as Error).message}`); }
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
        <button className="btn btn-ghost btn-sm" onClick={openPreview} title="תצוגה מקדימה של העמודים לפי המשאבים שהוספת">👁 תצוגה מקדימה</button>
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
              <select className="btn btn-ghost btn-sm" value={drive} onChange={(e) => setDrive(e.target.value as DriveType)} title="סוג הנעה לתבנית" style={{ padding: '6px 8px' }}>
                {(Object.keys(DRIVE_LABELS) as DriveType[]).map((d) => <option key={d} value={d}>{DRIVE_LABELS[d]}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadXlsx(`autospec-template-${drive}.xlsx`, writeXlsx(naturalTemplateSheets(drive)))} title="תבנית רב-גיליונות מותאמת לסוג ההנעה">הורד תבנית (Excel)</button>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv('autospec-template.csv', blankTemplateCells())} title="פורמט מתויג חלופי">CSV</button>
              {sheet && <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`${sheet.model || 'spec'}.csv`, sheetToCells(sheet))}>הורד כ-CSV</button>}
              <button className={aiOpen ? 'btn btn-sm on' : 'btn btn-ghost btn-sm'} onClick={() => setAiOpen((v) => !v)} title="השלמת טקסטים חסרים באמצעות AI">✨ השלם עם AI</button>
            </div>

            {/* item B — AI completion of missing marketing / equipment / legal copy */}
            {aiOpen && (
              <div style={{ padding: 14, borderBottom: '1px solid var(--line)', background: 'rgba(232,120,30,.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  ה-AI ישלים <b>רק טקסטים חסרים</b> (פסקת שיווק, שורות אבזור, טקסט משפטי) מתוך חומר המקור — לעולם לא נתונים מספריים. הדבק טקסט, <b>הדבק קישור לעמוד הדגם</b> (יסוכם אוטומטית), או טען PDF.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>מפתח Gemini:</span>
                  <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="מפתח חינמי מ-aistudio.google.com" dir="ltr"
                    style={{ flex: 1, minWidth: 200, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)', fontFamily: 'var(--mono)' }} />
                  <label style={{ fontSize: 12, fontWeight: 700 }}>מודל
                    <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} dir="ltr" style={{ marginInlineStart: 6, padding: 5, borderRadius: 8, border: '1px solid var(--line-2)' }}>
                      {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
                <textarea value={aiSource} onChange={(e) => setAiSource(e.target.value)} dir="rtl" placeholder="הדבק טקסט על הדגם, או קישור (URL) לעמוד הדגם באתר היצרן/יבואן — ה-AI יקרא ויסכם אותו…"
                  style={{ width: '100%', minHeight: 90, padding: 8, borderRadius: 8, border: '1px solid var(--line-2)', fontFamily: 'var(--font)', resize: 'vertical' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                    טען PDF על הדגם
                    <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadAiSourcePdf(f); e.currentTarget.value = ''; }} />
                  </label>
                  {aiSource && <button className="btn btn-ghost btn-sm" onClick={() => setAiSource('')}>נקה מקור</button>}
                  <div style={{ flex: 1 }} />
                  {aiMsg && <span style={{ fontSize: 12.5, color: aiMsg.startsWith('✓') ? 'var(--ok, #0a7d3b)' : aiMsg.startsWith('שגיאת') ? 'var(--danger)' : 'var(--ink-3)' }}>{aiMsg}</span>}
                  <button className="btn btn-sm" onClick={runAiComplete} disabled={aiBusy}
                    style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', opacity: aiBusy ? 0.6 : 1 }}>
                    {aiBusy ? 'משלים…' : '✨ השלם את החסר'}
                  </button>
                </div>
              </div>
            )}

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

      {/* item E — live preview of the generated pages (read-only, rendered from the real IR) */}
      {preview && <PreviewModal doc={preview} family={genFamily()} onClose={() => setPreview(null)} onCreate={() => { setPreview(null); onCreate(preview); }} />}
    </div>
  );
}

/** Read-only preview overlay: renders each generated page from the IR (the same renderer the
 * editor uses), so the user sees exactly how the page will look with the resources they added. */
function PreviewModal({ doc, family, onClose, onCreate }: { doc: DocumentIR; family: string; onClose: () => void; onCreate: () => void }) {
  const [i, setI] = React.useState(0);
  const page = doc.pages[i];
  const W = 560;
  const scale = Math.min(1, W / page.width);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(16,20,30,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxHeight: '92vh', width: 'min(96vw, 720px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <strong style={{ fontFamily: 'var(--display)' }}>תצוגה מקדימה</strong>
          <span style={{ color: 'var(--ink-3)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>עמוד {i + 1} מתוך {doc.pages.length}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>‹ הקודם</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setI((v) => Math.min(doc.pages.length - 1, v + 1))} disabled={i === doc.pages.length - 1}>הבא ›</button>
          <button className="btn btn-sm" onClick={onCreate} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px' }}>פתח בעורך ←</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>סגור</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', justifyContent: 'center', background: 'rgba(255,255,255,.14)' }}>
          <PageView page={page} scale={scale} mode="reconstructed" fontFamily={family} />
        </div>
        {/* page rail */}
        {doc.pages.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--line)', overflowX: 'auto' }}>
            {doc.pages.map((p, k) => (
              <button key={p.id} onClick={() => setI(k)} title={`עמוד ${k + 1}`}
                style={{ flexShrink: 0, width: 52, aspectRatio: `${p.width}/${p.height}`, border: k === i ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0 }}>
                {p.previewImage && <img src={p.previewImage} alt="" className="ui-img" style={{ width: '100%', display: 'block' }} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
