// Mode-aware page canvas. IR is the source of truth.
//  - original/compare show the reference raster; editable/reconstructed render from IR.
import { useRef, useState } from 'react';
import type { PageIR, TextBlockIR, ImageBlockIR, TableBlockIR, BlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock, isTableBlock, columnLeftFraction, resolveVAlign, vAlignToFlex } from '../types/catalog';
import { TextEditOverlay } from '../editor/TextEditOverlay';
import { pctRect, pct, scaledPx, scaledHairline } from '../editor/layerMath';
import { wrapText } from '../catalog/autofit';
import { edgeShadeBackground } from './imageFx';

export interface CellRef { tableId: string; r: number; c: number; }

export type ViewMode = 'original' | 'editable' | 'reconstructed' | 'compare';

interface Props {
  page: PageIR;
  scale: number;
  mode: ViewMode;
  fontFamily?: string;        // brand font for imported text
  selectedId?: string | null;
  /** All currently-selected block ids (multi-select); outlines every one. */
  selectedIds?: Set<string>;
  editingId?: string | null;
  /** `additive` (shift/⌘/ctrl-click) toggles the id in the multi-selection. */
  onSelect?: (id: string | null, additive?: boolean) => void;
  /** rubber-band selection result (ids intersecting the dragged rectangle). */
  onMarquee?: (ids: string[], additive: boolean) => void;
  onStartEdit?: (id: string) => void;
  onChangeText?: (id: string, text: string) => void;
  onResize?: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  onCommit?: () => void;
  // table cell editing
  editingCell?: CellRef | null;
  onStartEditCell?: (ref: CellRef) => void;
  onChangeCell?: (ref: CellRef, text: string) => void;
  onCommitCell?: () => void;
  /** ref to the page element, so a marquee can be started from outside the canvas. */
  pageRef?: React.Ref<HTMLDivElement>;
  /** text measurer override (px width of `text` at `px` size) — canvas by default; injectable
   * for tests/headless. Drives the F1 overflow indicator. */
  measureText?: (text: string, family: string, weight: number, px: number) => number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

// Editor↔export WYSIWYG parity for single-line text: the vector export shrinks a one-line box's
// font (down to a 0.72 floor) until it fits the box width (planTextLines). The editor renders the
// SAME shrink so nothing looks clipped on screen that would fit on export. Cached canvas measure.
let _mctx: CanvasRenderingContext2D | null | undefined;
const _mcache = new Map<string, number>();
function oneLineFitFactor(text: string, family: string, weight: number, px: number, maxW: number): number {
  if (_mctx === undefined) _mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!_mctx || !text) return 1;
  const key = `${weight}|${Math.round(px * 2) / 2}|${family}|${text}`;
  let w = _mcache.get(key);
  if (w === undefined) {
    _mctx.font = `${weight} ${px}px ${family}`;
    w = _mctx.measureText(text).width;
    if (_mcache.size > 4000) _mcache.clear();
    _mcache.set(key, w);
  }
  return w > maxW ? Math.max(0.72, maxW / w) : 1;
}

/** Default measurer: shared canvas (browser); null when no 2D context (headless). */
function canvasMeasure(text: string, family: string, weight: number, px: number): number | null {
  if (_mctx === undefined) _mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!_mctx) return null;
  _mctx.font = `${weight} ${px}px ${family}`;
  return _mctx.measureText(text).width;
}

export function PageView({ page, scale, mode, fontFamily, selectedId, selectedIds, editingId, onSelect, onMarquee, onStartEdit, onChangeText, onResize, onCommit, editingCell, onStartEditCell, onChangeCell, onCommitCell, pageRef, measureText }: Props) {
  const isSel = (id: string) => selectedIds ? selectedIds.has(id) : selectedId === id;
  const singleSel = !selectedIds || selectedIds.size <= 1;
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const w = page.width * scale;
  const h = page.height * scale;
  const showRaster = mode === 'original' || mode === 'compare';
  const showBlocks = mode !== 'original';
  const interactive = mode === 'editable';
  const compare = mode === 'compare';
  const drag = useRef<null | { id: string; corner: Corner; sx: number; sy: number; x: number; y: number; w: number; h: number }>(null);

  // free-drag move of any block (click selects; drag past threshold moves). If the block is part
  // of a multi-selection, ALL selected blocks move together by the same delta.
  const startMove = (b: BlockIR, e: React.MouseEvent) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const inGroup = !!selectedIds && selectedIds.has(b.id) && selectedIds.size > 1 && !additive;
    if (!inGroup) onSelect?.(b.id, additive);
    const movingIds = inGroup ? [...selectedIds!] : [b.id];
    const origs = movingIds
      .map((id) => page.blocks.find((x) => x.id === id))
      .filter((x): x is BlockIR => !!x)
      .map((bl) => ({ id: bl.id, x: bl.x, y: bl.y, w: bl.width, h: bl.height }));
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    // rAF-throttle: apply at most one document update per frame (raw mousemove can fire
    // 100+ times/sec and each update re-renders the whole page — visible jank on dense pages)
    let raf = 0; let lastEv: MouseEvent | null = null;
    const apply = () => {
      raf = 0;
      const ev = lastEv; if (!ev) return;
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      for (const o of origs) onResize?.(o.id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy), width: o.w, height: o.h });
    };
    const move = (ev: MouseEvent) => { lastEv = ev; if (!raf) raf = requestAnimationFrame(apply); };
    const up = () => { if (raf) cancelAnimationFrame(raf); apply(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // rubber-band (marquee) selection from an empty area of the page
  const startMarquee = (e: React.MouseEvent) => {
    if (!interactive || e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) onSelect?.(null);
    setMarquee({ x0: sx, y0: sy, x1: sx, y1: sy });
    const move = (ev: MouseEvent) => setMarquee({ x0: sx, y0: sy, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top });
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      const ex = ev.clientX - rect.left, ey = ev.clientY - rect.top;
      setMarquee(null);
      if (Math.abs(ex - sx) < 3 && Math.abs(ey - sy) < 3) return; // a click, not a drag
      const x0 = Math.min(sx, ex) / scale, y0 = Math.min(sy, ey) / scale, x1 = Math.max(sx, ex) / scale, y1 = Math.max(sy, ey) / scale;
      const ids = page.blocks.filter((bl) => !bl.deleted && !(bl.x > x1 || bl.x + bl.width < x0 || bl.y > y1 || bl.y + bl.height < y0)).map((bl) => bl.id);
      onMarquee?.(ids, additive);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const startResize = (b: BlockIR, corner: Corner, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    drag.current = { id: b.id, corner, sx: e.clientX, sy: e.clientY, x: b.x, y: b.y, w: b.width, h: b.height };
    let raf = 0; let lastEv: MouseEvent | null = null;
    const apply = () => {
      raf = 0;
      const ev = lastEv; const d = drag.current; if (!ev || !d || !onResize) return;
      const dx = (ev.clientX - d.sx) / scale, dy = (ev.clientY - d.sy) / scale;
      let { x, y, w: bw, h: bh } = d;
      if (d.corner.includes('e')) bw = d.w + dx;
      if (d.corner.includes('w')) { x = d.x + dx; bw = d.w - dx; }
      if (d.corner.includes('s')) bh = d.h + dy;
      if (d.corner.includes('n')) { y = d.y + dy; bh = d.h - dy; }
      bw = Math.max(8, bw); bh = Math.max(8, bh);
      onResize(d.id, { x: Math.round(x), y: Math.round(y), width: Math.round(bw), height: Math.round(bh) });
    };
    const move = (ev: MouseEvent) => { lastEv = ev; if (!raf) raf = requestAnimationFrame(apply); };
    const up = () => { if (raf) cancelAnimationFrame(raf); apply(); drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={pageRef}
      onMouseDown={startMarquee}
      // T3 (playbook): blocks are positioned in page-relative PERCENTAGES and sized through the
      // pdf.js `--scale-factor` contract — zoom only changes this container's size + one CSS var.
      style={{ position: 'relative', width: w, height: h, ['--scale-factor' as never]: String(scale), background: '#fff', boxShadow: '0 10px 28px rgba(28,48,90,.18)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}
    >
      {showRaster && page.previewImage && (
        <img src={page.previewImage} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none' }} />
      )}

      {/* shapes + images in ONE z-sorted pass — so a scrim/panel painted ON TOP of a photo (e.g. a
          heading darken-overlay) renders above it, exactly as in the source (not hidden behind it). */}
      {showBlocks && page.blocks
        .filter((b) => (isShapeBlock(b) || isImageBlock(b)) && !b.deleted)
        .slice().sort((a, b) => a.zIndex - b.zIndex)
        .map((blk) => {
          if (isShapeBlock(blk)) {
            const b = blk;
            return (
              <div key={b.id} style={{
                position: 'absolute', ...pctRect(b, page.width, page.height),
                background: b.fill || 'transparent', borderRadius: scaledPx(b.radius || 0),
                border: b.stroke ? `${scaledHairline(b.stroke.width, 1)} solid ${b.stroke.color}` : undefined,
                opacity: (compare ? 0.6 : 1) * (b.opacity ?? 1), pointerEvents: 'none',
              }} />
            );
          }
          const b = blk as ImageBlockIR;
          const selected = isSel(b.id);
          // crop = source-fraction window to SHOW: scale the image up (in % of the wrapper — fully
          // zoom-free) and offset so only that window fills the box; the wrapper clips the rest.
          const c = b.crop && b.crop.fw > 0 && b.crop.fh > 0 ? b.crop : null;
          const imgStyle: React.CSSProperties = c
            ? { position: 'absolute', width: `${100 / c.fw}%`, height: `${100 / c.fh}%`, left: `${(-c.fx * 100) / c.fw}%`, top: `${(-c.fy * 100) / c.fh}%`, objectFit: 'fill' }
            : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: b.fit || 'cover' };
          return (
            <span key={b.id} style={{ position: 'absolute', ...pctRect(b, page.width, page.height), overflow: 'hidden', outline: selected ? '1.5px solid var(--accent)' : 'none' }}>
              <img src={b.src} alt="" draggable={false}
                onMouseDown={interactive ? (e) => startMove(b, e) : undefined}
                style={{
                  ...imgStyle, userSelect: 'none',
                  opacity: (compare ? 0.6 : 1) * (b.opacity ?? 1),
                  transform: `rotate(${b.rotation || 0}deg) scaleX(${b.flipH ? -1 : 1})`, transformOrigin: 'center',
                  cursor: interactive ? (selected ? 'move' : 'pointer') : 'default',
                }} />
              {/* live per-edge darkening overlay (non-destructive; baked only on export) */}
              {b.edgeShade && (b.edgeShade.top || b.edgeShade.right || b.edgeShade.bottom || b.edgeShade.left) ? (
                <span style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: edgeShadeBackground(b.edgeShade), opacity: compare ? 0.6 : 1 }} />
              ) : null}
              {/* axis-aligned frame around the box (kept outside the rotate/flip transform) */}
              {b.stroke && (
                <span style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  border: `${scaledHairline(b.stroke.width)} solid ${b.stroke.color}`,
                  borderRadius: scaledPx(b.radius || 0), boxSizing: 'border-box',
                  opacity: compare ? 0.6 : 1,
                }} />
              )}
            </span>
          );
        })}

      {/* table blocks (editable spec grid) */}
      {showBlocks && page.blocks.filter(isTableBlock).filter((b) => !b.deleted).map((b: TableBlockIR) => {
        const selected = isSel(b.id);
        const nRows = Math.max(1, b.rows.length);
        const rowTop = (r: number) => `${((100 * r) / nRows).toFixed(4)}%`;
        const rowH = `${(100 / nRows).toFixed(4)}%`;
        return (
          <div key={b.id}
            onMouseDown={interactive ? (e) => startMove(b, e) : undefined}
            style={{
              position: 'absolute', ...pctRect(b, page.width, page.height),
              opacity: compare ? 0.6 : 1, cursor: interactive ? (selected ? 'move' : 'pointer') : 'default',
              outline: selected ? '1.5px solid var(--accent)' : 'none', background: b.cellBg || 'transparent',
            }}>
            {b.rows.map((row, r) => {
              if (row.kind === 'section') {
                return (
                  <div key={r} dir="rtl" onDoubleClick={interactive ? (e) => { e.stopPropagation(); onStartEditCell?.({ tableId: b.id, r, c: 0 }); } : undefined}
                    style={{ position: 'absolute', left: 0, top: rowTop(r), width: '100%', height: rowH,
                      display: 'flex', alignItems: vAlignToFlex(resolveVAlign(b, row)), justifyContent: 'flex-start', padding: `0 ${scaledPx(3)}`,
                      fontFamily: fontFamily || b.fontFamily, fontSize: scaledPx(b.fontSize), fontWeight: 700,
                      background: b.sectionBg || 'transparent',
                      color: compare ? 'rgba(20,40,120,.55)' : (b.headingColor || b.color), borderBottom: `${scaledHairline(0.6)} solid ${b.gridColor || '#d7dade'}`, overflow: 'hidden' }}>
                    {editingCell && editingCell.tableId === b.id && editingCell.r === r ? (
                      <input autoFocus dir="rtl" defaultValue={row.cells[0] || ''}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => onChangeCell?.({ tableId: b.id, r, c: 0 }, e.target.value)}
                        onBlur={() => onCommitCell?.()} onKeyDown={(e) => { if (e.key === 'Enter') onCommitCell?.(); }}
                        style={{ width: '100%', font: 'inherit', color: 'inherit', border: '1px solid var(--accent)', background: '#fff', padding: 0 }} />
                    ) : row.cells[0]}
                  </div>
                );
              }
              return Array.from({ length: b.columns }).map((_, c) => {
                const leftFrac = columnLeftFraction(b.colFractions, c);
                const isLabel = c === 0;
                const editingThis = editingCell && editingCell.tableId === b.id && editingCell.r === r && editingCell.c === c;
                return (
                  <div key={c} dir="rtl" onDoubleClick={interactive ? (e) => { e.stopPropagation(); onStartEditCell?.({ tableId: b.id, r, c }); } : undefined}
                    style={{ position: 'absolute', left: `${(leftFrac * 100).toFixed(4)}%`, top: rowTop(r), width: `${((b.colFractions[c] || 0) * 100).toFixed(4)}%`, height: rowH,
                      display: 'flex', alignItems: vAlignToFlex(resolveVAlign(b, row)), justifyContent: isLabel ? 'flex-start' : 'center', padding: `0 ${scaledPx(3)}`,
                      fontFamily: fontFamily || b.fontFamily, fontSize: scaledPx(b.fontSize), fontWeight: row.kind === 'header' ? 700 : 400,
                      color: compare ? 'rgba(20,40,120,.55)' : (row.kind === 'header' ? (b.headingColor || b.color) : b.color),
                      borderBottom: `${scaledHairline(0.4, 0.4)} solid ${b.gridColor || '#d7dade'}`,
                      borderInlineStart: c < b.columns - 1 ? `${scaledHairline(0.4, 0.4)} solid ${b.gridColor || '#d7dade'}` : undefined,
                      overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {editingThis ? (
                      <input autoFocus dir="rtl" defaultValue={row.cells[c] ?? ''}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => onChangeCell?.({ tableId: b.id, r, c }, e.target.value)}
                        onBlur={() => onCommitCell?.()} onKeyDown={(e) => { if (e.key === 'Enter') onCommitCell?.(); }}
                        style={{ width: '100%', font: 'inherit', color: 'inherit', textAlign: isLabel ? 'right' : 'center', border: '1px solid var(--accent)', background: '#fff', padding: 0 }} />
                    ) : (row.cells[c] ?? '')}
                  </div>
                );
              });
            })}
          </div>
        );
      })}

      {showBlocks && page.blocks.filter(isTextBlock).filter((b) => !b.deleted).map((b: TextBlockIR) => {
        if (interactive && editingId === b.id) {
          return <TextEditOverlay key={b.id} block={b} scale={scale} fontFamily={fontFamily}
            onChange={(t) => onChangeText?.(b.id, t)} onCommit={() => onCommit?.()} />;
        }
        const selected = isSel(b.id);
        // a single-line box must not wrap (matches the vector export, which clips to the box)
        const oneLine = b.height <= b.fontSize * (b.lineHeight || 1.2) * 1.5;
        // export-parity shrink: single lines whose brand-font width exceeds the box render at the
        // same reduced size the export will use. The ratio is scale-invariant — measure in points.
        const fit = oneLine
          ? oneLineFitFactor(b.text.replace(/\s*\n\s*/g, ' '), fontFamily || b.fontFamily, b.fontWeight || 400, b.fontSize, b.width + 0.5)
          : 1;
        // F1: in EDIT mode a block auto-grows to show ALL its text (min-height = the model bbox);
        // when content exceeds the model box (which export clips to), show a visible indicator —
        // nothing is ever silently hidden.
        const rect = pctRect(b, page.width, page.height);
        let overflowing = false;
        if (interactive && !oneLine) {
          const mt = measureText ?? canvasMeasure;
          const m = (t: string, s: number) => mt(t, fontFamily || b.fontFamily, b.fontWeight || 400, s) ?? NaN;
          const probe = m('אב', b.fontSize);
          if (Number.isFinite(probe)) {
            const contentH = wrapText(b.text, b.width, b.fontSize, m as (t: string, s: number) => number).length * b.fontSize * (b.lineHeight || 1.2);
            overflowing = contentH > b.height + 1;
          }
        }
        return (
          <div key={b.id}
            dir={b.direction === 'ltr' ? 'ltr' : 'rtl'}
            onMouseDown={interactive ? (e) => startMove(b, e) : undefined}
            onDoubleClick={interactive ? (e) => { e.stopPropagation(); onStartEdit?.(b.id); } : undefined}
            style={{
              position: 'absolute', ...rect,
              ...(interactive ? { height: 'auto', minHeight: rect.height, overflow: 'visible' } : { overflow: 'hidden' }),
              fontSize: scaledPx(b.fontSize * fit), lineHeight: b.lineHeight,
              fontFamily: fontFamily || b.fontFamily, fontWeight: b.fontWeight,
              color: compare ? 'rgba(20,40,120,.55)' : b.color,
              whiteSpace: oneLine ? 'nowrap' : 'pre-wrap',
              // rotated runs (vertical sidebars): rotate around the baseline-left point
              ...(b.rotation ? { transform: `rotate(${b.rotation}deg)`, transformOrigin: '0 77%' } : {}),
              unicodeBidi: 'plaintext',
              textAlign: b.align === 'end' ? 'right' : b.align === 'center' ? 'center' : 'left',
              cursor: interactive ? (selected ? 'move' : 'pointer') : 'default',
              outline: compare ? '1px dashed rgba(20,40,120,.4)' : overflowing ? '1.5px dashed #d62828' : selected ? '1.5px solid var(--accent)' : 'none',
              background: 'transparent',
            }}
          >
            {b.text}
            {overflowing && (
              <span data-overflow="true" title="הטקסט חורג מגבולות התיבה — בייצוא הוא ייחתך אלא אם תגדיל את התיבה"
                style={{ position: 'absolute', top: -8, insetInlineStart: -8, width: 15, height: 15, borderRadius: '50%',
                  background: '#d62828', color: '#fff', fontSize: 10, lineHeight: '15px', textAlign: 'center',
                  fontFamily: 'sans-serif', pointerEvents: 'none', zIndex: 40 }}>↕</span>
            )}
          </div>
        );
      })}

      {/* resize handles on the selected (non-editing) block — single selection only */}
      {interactive && selectedId && singleSel && editingId !== selectedId && (() => {
        const b = page.blocks.find((x) => x.id === selectedId);
        if (!b || b.deleted) return null;
        return (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
          <div key={c} onMouseDown={(e) => startResize(b, c, e)}
            style={{
              position: 'absolute', width: 10, height: 10, background: '#fff', border: '2px solid var(--accent)', borderRadius: 2, zIndex: 50,
              cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
              left: `calc(${pct(c.includes('w') ? b.x : b.x + b.width, page.width)} - 5px)`,
              top: `calc(${pct(c.includes('n') ? b.y : b.y + b.height, page.height)} - 5px)`,
            }} />
        ));
      })()}

      {/* rubber-band selection rectangle */}
      {marquee && (
        <div style={{
          position: 'absolute', pointerEvents: 'none', zIndex: 60,
          left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
          width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
          border: '1px solid var(--accent)', background: 'rgba(232,120,30,.12)',
        }} />
      )}
    </div>
  );
}
