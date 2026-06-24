// New structured-model app. Stage 2: import. Stage 3: IR-as-truth editor with a
// textarea overlay and Original/Editable/Reconstructed/Compare view modes.
import React from 'react';
import type { DocumentIR, TextBlockIR, ImageBlockIR, TableBlockIR, ShapeBlockIR, BlockIR } from '../types/catalog';
import type { TemplateSpec } from '../templates/templateSpec';
import { ImportScreen } from './ImportScreen';
import { TemplateScreen } from './TemplateScreen';
import { GenerateScreen } from './GenerateScreen';
import { PageView, type ViewMode, type CellRef } from './PageView';
import { LayersPanel } from './LayersPanel';
import { brandFont, ensureFontFace, FALLBACK_HEBREW, loadExportFonts } from './brandFont';
import { fitTextBlock, fitTableBlock, canvasMeasureFor } from '../catalog/autofit';
import { exportPdf } from '../pdf/exportPdf';
import { saveProject } from '../store/library';
import { removeBackground } from './imageBg';
import { tintImage, vignetteImage } from './imageFx';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'original', label: 'מקור' },
  { id: 'editable', label: 'עריכה' },
  { id: 'reconstructed', label: 'משוחזר' },
  { id: 'compare', label: 'השוואה' },
];

export function App() {
  // doc state with UNDO/REDO history. setDoc is history-aware (coalesces rapid changes — e.g. a
  // drag — into one undo step); resetHistory is used when opening a new document.
  const [doc, setDocRaw] = React.useState<DocumentIR | null>(null);
  const pastRef = React.useRef<DocumentIR[]>([]);
  const futureRef = React.useRef<DocumentIR[]>([]);
  const lastPushRef = React.useRef(0);
  const [, forceHist] = React.useReducer((x: number) => x + 1, 0);
  const setDoc = React.useCallback((updater: React.SetStateAction<DocumentIR | null>) => {
    setDocRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: DocumentIR | null) => DocumentIR | null)(prev) : updater;
      if (!prev || next === prev) return next;
      const now = Date.now();
      if (now - lastPushRef.current > 500) { // new undo step only when >500ms since the last
        pastRef.current.push(prev);
        if (pastRef.current.length > 80) pastRef.current.shift();
        futureRef.current = [];
        forceHist();
      }
      lastPushRef.current = now;
      return next;
    });
  }, []);
  const resetHistory = (d: DocumentIR | null) => { pastRef.current = []; futureRef.current = []; lastPushRef.current = 0; setDocRaw(d); forceHist(); };
  const undo = React.useCallback(() => {
    if (!pastRef.current.length) return;
    setDocRaw((cur) => { if (cur) futureRef.current.push(cur); return pastRef.current.pop()!; });
    lastPushRef.current = 0; setSel(null); setMulti(new Set()); setEditing(null); setEditingCell(null); forceHist();
  }, []);
  const redo = React.useCallback(() => {
    if (!futureRef.current.length) return;
    setDocRaw((cur) => { if (cur) pastRef.current.push(cur); return futureRef.current.pop()!; });
    lastPushRef.current = 0; setSel(null); setMulti(new Set()); setEditing(null); setEditingCell(null); forceHist();
  }, []);
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const [screen, setScreen] = React.useState<'import' | 'learn' | 'generate'>('import');
  const [genSpec, setGenSpec] = React.useState<TemplateSpec | null>(null);
  const [fromGen, setFromGen] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [mode, setMode] = React.useState<ViewMode>('editable');
  const [zoom, setZoom] = React.useState(1); // canvas zoom, independent of page rail
  const [bgTolerance, setBgTolerance] = React.useState(40); // background-removal sensitivity
  const [tintColor, setTintColor] = React.useState('#1b4fa0'); // image tint colour
  const [tintStrength, setTintStrength] = React.useState(50); // %
  const [vignette, setVignette] = React.useState(45); // edge-darken %
  const [sel, setSel] = React.useState<string | null>(null);
  const [multi, setMulti] = React.useState<Set<string>>(() => new Set());
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editingCell, setEditingCell] = React.useState<CellRef | null>(null);
  const [showLayers, setShowLayers] = React.useState(false);
  const [wrapMarquee, setWrapMarquee] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pageElRef = React.useRef<HTMLDivElement>(null);
  const clearSel = () => { setSel(null); setMulti(new Set()); setEditing(null); setEditingCell(null); };
  const [exporting, setExporting] = React.useState(false);
  const [exportErr, setExportErr] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const templateIdRef = React.useRef<string | undefined>(undefined);

  // Milestone C: autosave the in-progress catalog to IndexedDB (debounced). Saves on open
  // too, so a freshly imported/generated catalog appears in the library right away.
  React.useEffect(() => {
    if (!doc) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveProject(doc, { templateId: templateIdRef.current })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('idle'));
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  async function handleExport() {
    if (!doc || exporting) return;
    setExporting(true); setExportErr(null);
    try {
      const { regular, bold } = await loadExportFonts(doc.brand || '');
      const bytes = await exportPdf(doc, regular, bold);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(doc.sourcePdfName || 'catalog').replace(/\.pdf$/i, '')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const bf = doc ? brandFont(doc.brand || '') : null;
  React.useEffect(() => { if (bf) ensureFontFace(bf); }, [bf]);

  // soft-delete the selected block(s): hidden in the editor + skipped on export
  const deleteSelected = React.useCallback(() => {
    setDoc((d) => {
      if (!d) return d;
      const ids = multi.size ? multi : (sel ? new Set([sel]) : new Set<string>());
      if (!ids.size) return d;
      return { ...d, pages: d.pages.map((p, i) => i !== cur ? p : { ...p, blocks: p.blocks.map((b) => ids.has(b.id) ? { ...b, deleted: true, dirty: true } : b) }) };
    });
    setSel(null); setMulti(new Set()); setEditing(null); setEditingCell(null);
  }, [multi, sel, cur]);

  // nudge the selection by (dx,dy) points (arrow keys)
  const nudge = React.useCallback((dx: number, dy: number) => {
    const ids = multi.size ? multi : (sel ? new Set([sel]) : null);
    if (!ids) return;
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : { ...p, blocks: p.blocks.map((b) => ids.has(b.id) ? { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy), dirty: true } : b) }),
    });
  }, [multi, sel, cur]);

  // keyboard: Delete removes; arrows nudge (Shift = ×10). Ignored while typing in a field.
  React.useEffect(() => {
    const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      if (editing || editingCell || (!multi.size && !sel)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      const a = ARROWS[e.key];
      if (a) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; nudge(a[0] * s, a[1] * s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, nudge, undo, redo, editing, editingCell, multi, sel]);

  const openDoc = (d: DocumentIR, templateId?: string) => {
    templateIdRef.current = templateId;
    resetHistory(d); setScreen('import'); setCur(0); clearSel();
  };
  const goGenerate = (spec?: TemplateSpec) => { setGenSpec(spec || null); setScreen('generate'); };
  if (!doc && screen === 'learn') return <TemplateScreen onBack={() => setScreen('import')} onGenerate={goGenerate} />;
  if (!doc && screen === 'generate') return <GenerateScreen initialSpec={genSpec} onCreate={(d) => { setFromGen(true); openDoc(d, genSpec?.id); }} onBack={() => setScreen('import')} />;
  if (!doc) return (
    <ImportScreen
      onImported={openDoc}
      onLearnTemplate={() => setScreen('learn')}
      onGenerate={() => goGenerate()}
      onOpenProject={(d) => openDoc(d)}
      onUseTemplate={(spec) => goGenerate(spec)}
    />
  );

  const page = doc.pages[cur];
  const fitScale = Math.min(1, 880 / page.width);
  const scale = fitScale * zoom;
  const brandFamily = bf ? `'${bf.family}', ${FALLBACK_HEBREW}` : FALLBACK_HEBREW;
  const selAny = page.blocks.find((b) => b.id === sel);
  const selBlock = selAny?.type === 'text' ? (selAny as TextBlockIR) : undefined;
  const selImage = selAny?.type === 'image' ? (selAny as ImageBlockIR) : undefined;
  const selTable = selAny?.type === 'table' ? (selAny as TableBlockIR) : undefined;
  const selShape = selAny && (selAny.type === 'shape' || selAny.type === 'background') ? (selAny as ShapeBlockIR) : undefined;

  const patchBlock = (id: string, patch: Partial<BlockIR> & Record<string, unknown>) => {
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : {
        ...p,
        blocks: p.blocks.map((b) => b.id === id ? { ...b, ...patch, dirty: true } : b),
      }),
    });
  };

  // resize: tables keep height == rows*rowHeight, so recompute rowHeight on a vertical drag
  const handleResize = (id: string, box: { x: number; y: number; width: number; height: number }) => {
    const b = page.blocks.find((x) => x.id === id);
    if (b?.type === 'table') {
      const t = b as TableBlockIR;
      const rh = t.rows.length ? Math.max(8, box.height / t.rows.length) : t.rowHeight;
      patchBlock(id, { ...box, rowHeight: rh, fontSize: Math.min(t.fontSize, rh / 1.5) });
    } else patchBlock(id, box);
  };

  // update a TableBlockIR's rows immutably, keeping height in sync
  const patchTable = (id: string, fn: (t: TableBlockIR) => TableBlockIR) => {
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : {
        ...p,
        blocks: p.blocks.map((b) => {
          if (b.id !== id || b.type !== 'table') return b;
          const t = fn(structuredClone(b as TableBlockIR));
          t.height = t.rows.length * t.rowHeight;
          t.dirty = true;
          return t;
        }),
      }),
    });
  };
  const setCell = (ref: CellRef, text: string) => patchTable(ref.tableId, (t) => {
    if (t.rows[ref.r]) t.rows[ref.r].cells[ref.c] = text;
    return t;
  });
  const addRowAfter = (id: string, r: number) => patchTable(id, (t) => {
    const cells = new Array(t.columns).fill('');
    t.rows.splice(r + 1, 0, { kind: 'data', cells });
    return t;
  });
  const addSectionAfter = (id: string, r: number) => patchTable(id, (t) => {
    t.rows.splice(r + 1, 0, { kind: 'section', cells: ['קטגוריה חדשה'] });
    return t;
  });
  const removeRow = (id: string, r: number) => patchTable(id, (t) => {
    if (t.rows.length > 1) t.rows.splice(r, 1);
    return t;
  });
  const addTrim = (id: string) => patchTable(id, (t) => {
    t.columns += 1;
    const trimFrac = (1 - t.colFractions[0]) / (t.columns - 1);
    t.colFractions = [t.colFractions[0], ...new Array(t.columns - 1).fill(trimFrac)];
    for (const row of t.rows) { if (row.kind !== 'section') row.cells.push(row.kind === 'header' ? `גרסה ${t.columns - 1}` : ''); }
    return t;
  });
  const removeTrim = (id: string) => patchTable(id, (t) => {
    if (t.columns <= 2) return t; // keep at least label + 1 trim
    t.columns -= 1;
    const trimFrac = (1 - t.colFractions[0]) / (t.columns - 1);
    t.colFractions = [t.colFractions[0], ...new Array(t.columns - 1).fill(trimFrac)];
    for (const row of t.rows) { if (row.kind !== 'section') row.cells.pop(); }
    return t;
  });

  // select every (non-deleted) block on the current page
  const selectAll = () => {
    const ids = page.blocks.filter((b) => !b.deleted).map((b) => b.id);
    if (!ids.length) return;
    setMulti(new Set(ids)); setSel(ids[ids.length - 1]); setEditing(null); setEditingCell(null);
  };
  // toggle one block in the multi-selection (from the layers checklist)
  const toggleSel = (id: string) => { setMulti((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setSel(id); setEditing(null); setEditingCell(null); };
  const selectOnly = (id: string) => { setMulti(new Set([id])); setSel(id); setEditing(null); setEditingCell(null); };
  // add a semi-transparent dark "scrim" panel behind a text block — restores readability where the
  // source used a gradient/soft-mask darken-overlay that the IR can't reconstruct. Sits ABOVE the
  // photo (high zIndex) but just BELOW the text.
  const addScrimBehind = (b: TextBlockIR) => {
    const pad = 8;
    const scrim: ShapeBlockIR = {
      id: `${page.id}_scrim${Date.now()}`, type: 'shape',
      x: Math.round(b.x - pad), y: Math.round(b.y - pad), width: Math.round(b.width + pad * 2), height: Math.round(b.height + pad * 2),
      rotation: 0, zIndex: (b.zIndex ?? 1_000_000) - 1, source: 'user', dirty: true,
      fill: '#0b0d12', opacity: 0.45, radius: 6,
    };
    setDoc((d) => !d ? d : { ...d, pages: d.pages.map((p, i) => i !== cur ? p : { ...p, blocks: [...p.blocks, scrim] }) });
  };

  // remove every shape/background block from the current selection (keep text/images/tables)
  const deselectShapes = () => {
    const shapeIds = new Set(page.blocks.filter((b) => b.type === 'shape' || b.type === 'background').map((b) => b.id));
    setMulti((prev) => new Set([...prev].filter((id) => !shapeIds.has(id))));
    if (sel && shapeIds.has(sel)) setSel(null);
  };

  // rubber-band selection that can START in the grey area OUTSIDE the page (maps to page coords)
  const startWrapMarquee = (e: React.MouseEvent) => {
    if (mode !== 'editable' || e.target !== e.currentTarget) return;
    const pageEl = pageElRef.current; if (!pageEl) return;
    const pr = pageEl.getBoundingClientRect();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) clearSel();
    const sx = e.clientX, sy = e.clientY;
    setWrapMarquee({ x0: sx, y0: sy, x1: sx, y1: sy });
    const move = (ev: MouseEvent) => setWrapMarquee({ x0: sx, y0: sy, x1: ev.clientX, y1: ev.clientY });
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      setWrapMarquee(null);
      if (Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      const x0 = (Math.min(sx, ev.clientX) - pr.left) / scale, y0 = (Math.min(sy, ev.clientY) - pr.top) / scale;
      const x1 = (Math.max(sx, ev.clientX) - pr.left) / scale, y1 = (Math.max(sy, ev.clientY) - pr.top) / scale;
      const ids = page.blocks.filter((b) => !b.deleted && !(b.x > x1 || b.x + b.width < x0 || b.y > y1 || b.y + b.height < y0)).map((b) => b.id);
      setMulti((prev) => { const n = additive ? new Set(prev) : new Set<string>(); ids.forEach((id) => n.add(id)); return n; });
      if (ids.length) setSel(ids[ids.length - 1]);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  // bring the selection to the front / send to the back (z-order control)
  const changeZ = (mode: 'front' | 'back') => {
    const ids = multi.size ? multi : (sel ? new Set([sel]) : null);
    if (!ids) return;
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => {
        if (i !== cur) return p;
        const zs = p.blocks.map((b) => b.zIndex ?? 0);
        const maxZ = Math.max(0, ...zs), minZ = Math.min(0, ...zs);
        let k = 1;
        return { ...p, blocks: p.blocks.map((b) => ids.has(b.id) ? { ...b, zIndex: mode === 'front' ? maxZ + (k++) : minZ - (k++), dirty: true } : b) };
      }),
    });
  };
  // bulk-edit all selected TEXT blocks (colour / size / bold / align / direction)
  const patchSelectedText = (patch: Partial<TextBlockIR> & Record<string, unknown>) => {
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : { ...p, blocks: p.blocks.map((b) => multi.has(b.id) && b.type === 'text' ? { ...b, ...patch, dirty: true } : b) }),
    });
  };
  const bumpSelectedSize = (delta: number) => {
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : { ...p, blocks: p.blocks.map((b) => multi.has(b.id) && b.type === 'text' ? { ...b, fontSize: Math.max(5, Math.round(((b as TextBlockIR).fontSize + delta) * 10) / 10), dirty: true } : b) }),
    });
  };
  const selTextCount = page.blocks.filter((b) => multi.has(b.id) && b.type === 'text' && !b.deleted).length;

  // one-click background removal on the selected image (tolerance from the panel slider)
  const removeBg = async () => {
    if (!selImage) return;
    // always run from the ORIGINAL so re-adjusting the slider re-runs cleanly (not on an already-cut image)
    try { const out = await removeBackground(selImage.originalImageRef || selImage.src, bgTolerance); patchBlock(selImage.id, { src: out }); } catch { /* ignore */ }
  };
  // recolour / edge-darken the selected image (baked into the pixels; stacks on the current image)
  const applyTint = async () => { if (!selImage) return; try { const out = await tintImage(selImage.src, tintColor, tintStrength / 100); patchBlock(selImage.id, { src: out }); } catch { /* ignore */ } };
  const applyVignette = async () => { if (!selImage) return; try { const out = await vignetteImage(selImage.src, vignette / 100); patchBlock(selImage.id, { src: out }); } catch { /* ignore */ } };

  // "Fit text": make every text box on the page show its FULL text (shrink→wrap→grow, no clip),
  // and shrink each table's font so no cell clips — keeping table alignment intact.
  const fitPageText = () => {
    const measureFor = canvasMeasureFor(brandFamily);
    const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const ctx = cv?.getContext('2d') || null;
    const cellMeasure = (text: string, size: number, bold: boolean) => {
      if (!ctx) return text.length * size * 0.5;
      ctx.font = `${bold ? 700 : 400} ${size}px ${brandFamily}`;
      return ctx.measureText(text).width;
    };
    setDoc((d) => !d ? d : {
      ...d,
      pages: d.pages.map((p, i) => i !== cur ? p : {
        ...p,
        blocks: p.blocks.map((b) => {
          if (b.deleted) return b;
          if (b.type === 'text') {
            const tb = b as TextBlockIR;
            const r = fitTextBlock(tb, measureFor(tb), p.height, 0.55);
            return { ...tb, fontSize: r.fontSize, height: r.height, dirty: true };
          }
          if (b.type === 'table') {
            const t = structuredClone(b as TableBlockIR);
            fitTableBlock(t, cellMeasure);
            t.dirty = true;
            return t;
          }
          return b;
        }),
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
        {mode === 'editable' && <button className={showLayers ? 'btn btn-sm on' : 'btn btn-ghost btn-sm'} onClick={() => setShowLayers((v) => !v)} style={{ fontSize: 12 }}>שכבות</button>}
        {mode === 'editable' && <button className="btn btn-ghost btn-sm" onClick={selectAll} style={{ fontSize: 12 }}>בחר הכל</button>}
        {mode === 'editable' && <button className="btn btn-ghost btn-sm" onClick={fitPageText} style={{ fontSize: 12 }} title="ודא שכל הטקסטים והטבלאות בעמוד מוצגים במלואם, בלי חיתוך">התאם טקסט</button>}
        <div className="seg" style={{ display: 'flex', alignItems: 'center' }} title="גודל תצוגת הקאנבס (לא משנה את גודל העמוד)">
          <button onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))} style={{ fontSize: 13, padding: '0 8px' }}>−</button>
          <button onClick={() => setZoom(1)} style={{ fontSize: 11, minWidth: 46, fontVariantNumeric: 'tabular-nums' }} title="אפס זום ל-100%">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))} style={{ fontSize: 13, padding: '0 8px' }}>+</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!canUndo} title="בטל (Ctrl/⌘+Z)" style={{ fontSize: 14, opacity: canUndo ? 1 : 0.4 }}>↶</button>
        <button className="btn btn-ghost btn-sm" onClick={redo} disabled={!canRedo} title="חזור (Ctrl/⌘+Shift+Z)" style={{ fontSize: 14, opacity: canRedo ? 1 : 0.4 }}>↷</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: saveState === 'saved' ? 'var(--ok, #0a7d3b)' : 'var(--ink-3)' }}>
          {saveState === 'saving' ? 'שומר…' : saveState === 'saved' ? '✓ נשמר' : ''}
        </span>
        {exportErr && <span style={{ color: 'var(--danger)', fontSize: 12 }} title={exportErr}>שגיאת ייצוא</span>}
        <button className="btn btn-sm" onClick={handleExport} disabled={exporting}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', opacity: exporting ? 0.6 : 1 }}>
          {exporting ? 'מייצא…' : 'ייצוא PDF'}
        </button>
        {fromGen && <button className="btn btn-ghost btn-sm" onClick={() => { resetHistory(null); setFromGen(false); setScreen('generate'); }}>← חזרה ליצירה</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => { setFromGen(false); resetHistory(null); }}>ייבוא אחר</button>
      </header>

      {wrapMarquee && (
        <div style={{
          position: 'fixed', pointerEvents: 'none', zIndex: 9999,
          left: Math.min(wrapMarquee.x0, wrapMarquee.x1), top: Math.min(wrapMarquee.y0, wrapMarquee.y1),
          width: Math.abs(wrapMarquee.x1 - wrapMarquee.x0), height: Math.abs(wrapMarquee.y1 - wrapMarquee.y0),
          border: '1px solid var(--accent)', background: 'rgba(232,120,30,.12)',
        }} />
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* page rail */}
        <div style={{ width: 116, flexShrink: 0, overflowY: 'auto', padding: 10, borderInlineEnd: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          {doc.pages.map((p, i) => (
            <button key={p.id} onClick={() => { setCur(i); clearSel(); }}
              style={{ display: 'block', width: '100%', marginBottom: 8, cursor: 'pointer', border: i === cur ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', background: '#fff', aspectRatio: `${p.width}/${p.height}` }}>
              {p.previewImage && <img src={p.previewImage} alt="" className="ui-img" style={{ width: '100%', display: 'block' }} />}
            </button>
          ))}
        </div>

        {/* layers / elements checklist */}
        {mode === 'editable' && showLayers && (
          <LayersPanel blocks={page.blocks} selectedIds={multi.size ? multi : (sel ? new Set([sel]) : new Set())}
            onToggle={toggleSel} onSelectOnly={selectOnly} onClear={clearSel} onDeselectShapes={deselectShapes} />
        )}

        {/* canvas */}
        <div onMouseDown={startWrapMarquee}
          style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 28, background: 'rgba(255,255,255,.14)' }}>
          <PageView
            pageRef={pageElRef}
            page={page} scale={scale} mode={mode} fontFamily={brandFamily}
            selectedId={sel} selectedIds={multi} editingId={editing}
            onSelect={(id, additive) => {
              if (id == null) { clearSel(); return; }
              setSel(id);
              setMulti((prev) => {
                if (additive) { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }
                return new Set([id]);
              });
              if (editing && editing !== id) setEditing(null);
              setEditingCell(null);
            }}
            onMarquee={(ids, additive) => {
              setMulti((prev) => { const n = additive ? new Set(prev) : new Set<string>(); ids.forEach((id) => n.add(id)); return n; });
              if (ids.length) setSel(ids[ids.length - 1]);
              setEditing(null); setEditingCell(null);
            }}
            onStartEdit={(id) => { setSel(id); setEditing(id); }}
            onChangeText={(id, text) => patchBlock(id, { text })}
            onResize={handleResize}
            onCommit={() => setEditing(null)}
            editingCell={editingCell}
            onStartEditCell={(ref) => { setSel(ref.tableId); setEditingCell(ref); }}
            onChangeCell={(ref, text) => setCell(ref, text)}
            onCommitCell={() => setEditingCell(null)}
          />
        </div>

        {/* properties */}
        <div style={{ width: 264, flexShrink: 0, borderInlineStart: '1px solid var(--line)', background: 'var(--surface-2)', padding: 16, overflowY: 'auto' }}>
          {mode !== 'editable' ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>עבור למצב <b>עריכה</b> כדי לבחור ולערוך. קליק=בחירה · Shift/⌘-קליק=בחירה מרובה · גרירה=הזזה · דאבל-קליק=עריכה · Delete=מחיקה.</p>
          ) : multi.size > 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>{multi.size} אלמנטים נבחרו</div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0 }}>גרירה=הזזה יחד · חיצים=הזזה עדינה (Shift ×10) · Shift-קליק מוסיף/מסיר.</p>
              {selTextCount > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>עריכת {selTextCount} תיבות טקסט יחד</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => bumpSelectedSize(-1)}>א−</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => bumpSelectedSize(1)}>א+</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => patchSelectedText({ fontWeight: 700 })} style={{ fontWeight: 800 }}>B</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => patchSelectedText({ fontWeight: 400 })}>רגיל</button>
                  </div>
                  <div className="seg">
                    {(['start', 'center', 'end'] as const).map((al) => (
                      <button key={al} onClick={() => patchSelectedText({ align: al })} style={{ flex: 1, fontSize: 12 }}>{al === 'start' ? 'ימין' : al === 'center' ? 'מרכז' : 'שמאל'}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    {['#111418', '#ffffff', '#c0142d', '#1b4fa0', '#0a7d3b'].map((c) => (
                      <button key={c} onClick={() => patchSelectedText({ color: c })} title={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: '1px solid var(--line-2)' }} />
                    ))}
                    <input type="color" onChange={(e) => patchSelectedText({ color: e.target.value })} style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                  </div>
                </div>
              )}
              <div className="seg">
                <button onClick={() => changeZ('front')} style={{ flex: 1, fontSize: 12 }}>⤒ לקדמה</button>
                <button onClick={() => changeZ('back')} style={{ flex: 1, fontSize: 12 }}>⤓ לאחור</button>
              </div>
              <button className="btn btn-sm" onClick={deleteSelected} style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px' }}>מחק {multi.size} אלמנטים</button>
              <button className="btn btn-ghost btn-sm" onClick={clearSel}>בטל בחירה</button>
            </div>
          ) : selImage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>תמונה</div>
              <img src={selImage.src} alt="" className="ui-img" style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: 'var(--surface-3)', borderRadius: 8 }} />
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
              <label style={{ fontSize: 12, fontWeight: 700 }}>שקיפות: {Math.round((selImage.opacity ?? 1) * 100)}%
                <input type="range" min={0} max={100} value={Math.round((selImage.opacity ?? 1) * 100)}
                  onChange={(e) => patchBlock(selImage.id, { opacity: +e.target.value / 100 })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>היפוך וסיבוב</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={selImage.flipH ? 'btn btn-sm on' : 'btn btn-ghost btn-sm'} style={{ flex: 1 }} onClick={() => patchBlock(selImage.id, { flipH: !selImage.flipH })} title="היפוך אופקי">⇋ היפוך</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => patchBlock(selImage.id, { rotation: (((selImage.rotation || 0) - 90) % 360 + 360) % 360 })} title="סיבוב נגד כיוון השעון">↺ 90°</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => patchBlock(selImage.id, { rotation: ((selImage.rotation || 0) + 90) % 360 })} title="סיבוב עם כיוון השעון">↻ 90°</button>
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
              {/* outline / frame around the image */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>קו מתאר</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                    onClick={() => patchBlock(selImage.id, { stroke: selImage.stroke ? undefined : { color: '#111418', width: 2 } })}>
                    {selImage.stroke ? 'הסר' : 'הוסף'}
                  </button>
                </div>
                {selImage.stroke && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      {['#111418', '#ffffff', '#c0142d', '#1b4fa0', '#0a7d3b', '#9aa0a6'].map((c) => (
                        <button key={c} onClick={() => patchBlock(selImage.id, { stroke: { color: c, width: selImage.stroke!.width } })} title={c}
                          style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: (selImage.stroke!.color || '').toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                      ))}
                      <input type="color" value={/^#[0-9a-f]{6}$/i.test(selImage.stroke.color) ? selImage.stroke.color : '#111418'}
                        onChange={(e) => patchBlock(selImage.id, { stroke: { color: e.target.value, width: selImage.stroke!.width } })}
                        style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                    </div>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>עובי: {selImage.stroke.width}
                      <input type="range" min={0.5} max={12} step={0.5} value={selImage.stroke.width}
                        onChange={(e) => patchBlock(selImage.id, { stroke: { color: selImage.stroke!.color, width: +e.target.value } })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                    </label>
                    <label style={{ fontSize: 12, fontWeight: 700 }}>עיגול פינות: {Math.round(selImage.radius || 0)}
                      <input type="range" min={0} max={40} step={1} value={selImage.radius || 0}
                        onChange={(e) => patchBlock(selImage.id, { radius: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                    </label>
                  </div>
                )}
              </div>
              {/* manual crop — source-fraction window to show (left/right/top/bottom insets) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>חיתוך תמונה</span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                    onClick={() => patchBlock(selImage.id, { crop: selImage.crop ? undefined : { fx: 0, fy: 0, fw: 1, fh: 1 } })}>
                    {selImage.crop ? 'בטל חיתוך' : 'הפעל חיתוך'}
                  </button>
                </div>
                {selImage.crop && (() => {
                  const c = selImage.crop;
                  const left = Math.round(c.fx * 100), top = Math.round(c.fy * 100);
                  const right = Math.round((1 - c.fx - c.fw) * 100), bottom = Math.round((1 - c.fy - c.fh) * 100);
                  const setCrop = (l: number, r: number, t: number, btm: number) => {
                    const fx = Math.min(0.9, Math.max(0, l / 100)), fy = Math.min(0.9, Math.max(0, t / 100));
                    const fw = Math.max(0.1, 1 - fx - Math.max(0, r / 100)), fh = Math.max(0.1, 1 - fy - Math.max(0, btm / 100));
                    patchBlock(selImage.id, { crop: { fx, fy, fw, fh } });
                  };
                  const Row = ({ label, val, on }: { label: string; val: number; on: (v: number) => void }) => (
                    <label style={{ fontSize: 12, fontWeight: 700, display: 'block' }}>{label}: {val}%
                      <input type="range" min={0} max={80} value={val} onChange={(e) => on(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                    </label>
                  );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <Row label="חיתוך משמאל" val={left} on={(v) => setCrop(v, right, top, bottom)} />
                      <Row label="חיתוך מימין" val={right} on={(v) => setCrop(left, v, top, bottom)} />
                      <Row label="חיתוך מלמעלה" val={top} on={(v) => setCrop(left, right, v, bottom)} />
                      <Row label="חיתוך מלמטה" val={bottom} on={(v) => setCrop(left, right, top, v)} />
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, marginTop: 2 }} onClick={() => patchBlock(selImage.id, { crop: { fx: 0, fy: 0, fw: 1, fh: 1 } })}>אפס חיתוך</button>
                    </div>
                  );
                })()}
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700 }}>רגישות הסרת רקע: {bgTolerance}
                  <input type="range" min={12} max={90} value={bgTolerance} onChange={(e) => setBgTolerance(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={removeBg}>הסר רקע</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => patchBlock(selImage.id, { src: selImage.originalImageRef || selImage.src })} title="החזר את התמונה המקורית">בטל</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>נשאר רקע? הגדל רגישות. נחתכו אזורים מהאובייקט? הקטן רגישות, ולחץ שוב.</div>
              </div>
              {/* recolour (tint) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>צביעה בגוון</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
                  {['#1b4fa0', '#c0142d', '#0a7d3b', '#7a3cb8', '#d98a00', '#111418', '#9aa0a6'].map((c) => (
                    <button key={c} onClick={() => setTintColor(c)} title={c}
                      style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: tintColor.toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                  ))}
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(tintColor) ? tintColor : '#1b4fa0'} onChange={(e) => setTintColor(e.target.value)}
                    style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                </div>
                <label style={{ fontSize: 12, fontWeight: 700 }}>עוצמה: {tintStrength}%
                  <input type="range" min={5} max={100} value={tintStrength} onChange={(e) => setTintStrength(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                </label>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={applyTint}>החל צביעה</button>
              </div>
              {/* darken edges (vignette) */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700 }}>הכהיית קצוות (מבחוץ פנימה): {vignette}%
                  <input type="range" min={5} max={95} value={vignette} onChange={(e) => setVignette(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                </label>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={applyVignette}>החל הכהיית קצוות</button>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>אפשר לשלב צביעה והכהיה. "איפוס" למטה מחזיר את התמונה המקורית.</div>
              </div>
              <div className="seg">
                <button onClick={() => changeZ('front')} style={{ flex: 1, fontSize: 12 }}>⤒ לקדמה</button>
                <button onClick={() => changeZ('back')} style={{ flex: 1, fontSize: 12 }}>⤓ לאחור</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { const o = selImage.originalBBox; patchBlock(selImage.id, { src: selImage.originalImageRef || selImage.src, fit: 'cover', flipH: false, rotation: 0, ...(o ? { x: o.x, y: o.y, width: o.width, height: o.height } : {}) }); }}>איפוס</button>
              <button className="btn btn-ghost btn-sm" onClick={deleteSelected} style={{ color: 'var(--danger)' }}>מחק תמונה</button>
            </div>
          ) : selTable ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>טבלת מפרט</div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0 }}>
                דאבל-קליק על תא לעריכה ידנית. {selTable.rows.length} שורות · {selTable.columns - 1} גרסאות.
              </p>
              <label style={{ fontSize: 12, fontWeight: 700 }}>גודל גופן: {Math.round(selTable.fontSize)}
                <input type="range" min={5} max={20} step={0.5} value={selTable.fontSize}
                  onChange={(e) => patchBlock(selTable.id, { fontSize: +e.target.value })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 700 }}>גובה שורה: {Math.round(selTable.rowHeight)}
                <input type="range" min={9} max={40} step={1} value={selTable.rowHeight}
                  onChange={(e) => { const rh = +e.target.value; patchTable(selTable.id, (t) => { t.rowHeight = rh; return t; }); }} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>רקע תאים (לכל הטבלה)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <button onClick={() => patchBlock(selTable.id, { cellBg: undefined })} title="ללא"
                    style={{ width: 24, height: 24, borderRadius: 6, background: 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 50%/10px 10px', cursor: 'pointer', border: !selTable.cellBg ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                  {['#ffffff', '#f3f4f6', '#e9eaee', '#1d1f22'].map((c) => (
                    <button key={c} onClick={() => patchBlock(selTable.id, { cellBg: c })} title={c}
                      style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: (selTable.cellBg || '').toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                  ))}
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(selTable.cellBg || '') ? selTable.cellBg! : '#ffffff'}
                    onChange={(e) => patchBlock(selTable.id, { cellBg: e.target.value })}
                    style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>שורות</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { const r = editingCell?.tableId === selTable.id ? editingCell.r : selTable.rows.length - 1; addRowAfter(selTable.id, r); }}>+ שורת נתון</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { const r = editingCell?.tableId === selTable.id ? editingCell.r : selTable.rows.length - 1; addSectionAfter(selTable.id, r); }}>+ קטגוריה</button>
                </div>
                {editingCell?.tableId === selTable.id && (
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, color: 'var(--danger)' }} onClick={() => { removeRow(selTable.id, editingCell.r); setEditingCell(null); }}>מחק שורה נבחרת (#{editingCell.r + 1})</button>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>עמודות גרסה</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => addTrim(selTable.id)}>+ גרסה</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeTrim(selTable.id)} disabled={selTable.columns <= 2}>– גרסה</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>רוחב
                  <input type="number" value={Math.round(selTable.width)} onChange={(e) => patchBlock(selTable.id, { width: +e.target.value })} style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </label>
              </div>
              <div className="seg">
                <button onClick={() => changeZ('front')} style={{ flex: 1, fontSize: 12 }}>⤒ לקדמה</button>
                <button onClick={() => changeZ('back')} style={{ flex: 1, fontSize: 12 }}>⤓ לאחור</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={deleteSelected} style={{ color: 'var(--danger)' }}>מחק טבלה</button>
            </div>
          ) : selShape ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontWeight: 800 }}>{selShape.type === 'background' ? 'רקע' : 'צורה'}</div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0 }}>פאנל/רקע מהמקור. אפשר לשנות צבע, שקיפות, או למחוק.</p>
              <label style={{ fontSize: 12, fontWeight: 700 }}>שקיפות: {Math.round((selShape.opacity ?? 1) * 100)}%
                <input type="range" min={0} max={100} value={Math.round((selShape.opacity ?? 1) * 100)}
                  onChange={(e) => patchBlock(selShape.id, { opacity: +e.target.value / 100 })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>צבע מילוי</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  {['#111418', '#ffffff', '#c0142d', '#1b4fa0', '#0a7d3b', '#9aa0a6'].map((c) => (
                    <button key={c} onClick={() => patchBlock(selShape.id, { fill: c })} title={c}
                      style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: (selShape.fill || '').toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--line-2)' }} />
                  ))}
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(selShape.fill || '') ? selShape.fill! : '#111418'}
                    onChange={(e) => patchBlock(selShape.id, { fill: e.target.value })}
                    style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                </div>
              </div>
              <div className="seg">
                <button onClick={() => changeZ('front')} style={{ flex: 1, fontSize: 12 }}>⤒ לקדמה</button>
                <button onClick={() => changeZ('back')} style={{ flex: 1, fontSize: 12 }}>⤓ לאחור</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={deleteSelected} style={{ color: 'var(--danger)' }}>מחק צורה</button>
            </div>
          ) : !selBlock ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>בחר אלמנט (קליק) — טקסט, תמונה או טבלה. Shift/⌘-קליק לבחירה מרובה. Delete למחיקה.</p>
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
                  className={selBlock.fontWeight >= 700 ? 'on' : ''} title="הדגשה (מודגש/רגיל)"
                  style={{ width: 44, fontWeight: 800, border: '1px solid var(--line-2)', borderRadius: 8, background: selBlock.fontWeight >= 700 ? 'var(--accent-soft)' : 'var(--surface)', color: selBlock.fontWeight >= 700 ? 'var(--accent-ink)' : 'var(--ink)' }}>B</button>
                <div className="seg" style={{ flex: 1 }}>
                  {(['start', 'center', 'end'] as const).map((a) => (
                    <button key={a} className={selBlock.align === a ? 'on' : ''} onClick={() => patchBlock(selBlock.id, { align: a })} style={{ flex: 1, fontSize: 12 }}>{a === 'start' ? 'ימין' : a === 'center' ? 'מרכז' : 'שמאל'}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>כיוון טקסט</div>
                <div className="seg">
                  <button className={selBlock.direction === 'rtl' ? 'on' : ''} onClick={() => patchBlock(selBlock.id, { direction: 'rtl', align: 'end' })} style={{ flex: 1, fontSize: 12 }}>RTL ימין-לשמאל</button>
                  <button className={selBlock.direction === 'ltr' ? 'on' : ''} onClick={() => patchBlock(selBlock.id, { direction: 'ltr', align: 'start' })} style={{ flex: 1, fontSize: 12 }}>LTR שמאל-לימין</button>
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
                    onChange={(e) => patchBlock(selBlock.id, { color: e.target.value })} title="דוגם צבעים"
                    style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                  <input type="text" defaultValue={selBlock.color} key={selBlock.id + selBlock.color} dir="ltr"
                    onChange={(e) => { const v = e.target.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{6}$/i.test(v)) patchBlock(selBlock.id, { color: v }); }}
                    placeholder="#rrggbb" title="קוד צבע מדויק (HEX)"
                    style={{ width: 86, fontFamily: 'var(--mono)', fontSize: 12, padding: '5px 7px', border: '1px solid var(--line-2)', borderRadius: 6 }} />
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
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums' }} dir="ltr">
                x{Math.round(selBlock.x)} y{Math.round(selBlock.y)} · {selBlock.direction} · {selBlock.dirty ? 'edited' : 'original'}
              </div>
              <div className="seg">
                <button onClick={() => changeZ('front')} style={{ flex: 1, fontSize: 12 }}>⤒ לקדמה</button>
                <button onClick={() => changeZ('back')} style={{ flex: 1, fontSize: 12 }}>⤓ לאחור</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => addScrimBehind(selBlock)} title="הוסף רקע כהה שקוף-למחצה מאחורי הטקסט לשיפור קריאוּת (למשל כותרת לבנה על תמונה)">+ הצללה מאחורי הטקסט</button>
              <button className="btn btn-ghost btn-sm" onClick={deleteSelected} style={{ color: 'var(--danger)' }}>מחק טקסט</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
