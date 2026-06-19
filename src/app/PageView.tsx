// Mode-aware page canvas. IR is the source of truth.
//  - original/compare show the reference raster; editable/reconstructed render from IR.
import { useRef } from 'react';
import type { PageIR, TextBlockIR, ImageBlockIR, ShapeBlockIR, BlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock } from '../types/catalog';
import { TextEditOverlay } from '../editor/TextEditOverlay';

export type ViewMode = 'original' | 'editable' | 'reconstructed' | 'compare';

interface Props {
  page: PageIR;
  scale: number;
  mode: ViewMode;
  fontFamily?: string;        // brand font for imported text
  selectedId?: string | null;
  editingId?: string | null;
  onSelect?: (id: string | null) => void;
  onStartEdit?: (id: string) => void;
  onChangeText?: (id: string, text: string) => void;
  onResize?: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  onCommit?: () => void;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

export function PageView({ page, scale, mode, fontFamily, selectedId, editingId, onSelect, onStartEdit, onChangeText, onResize, onCommit }: Props) {
  const w = page.width * scale;
  const h = page.height * scale;
  const showRaster = mode === 'original' || mode === 'compare';
  const showBlocks = mode !== 'original';
  const interactive = mode === 'editable';
  const compare = mode === 'compare';
  const drag = useRef<null | { id: string; corner: Corner; sx: number; sy: number; x: number; y: number; w: number; h: number }>(null);

  // free-drag move of any block (click selects; drag past threshold moves)
  const startMove = (b: BlockIR, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(b.id);
    const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
    let moved = false;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      onResize?.(b.id, { x: Math.round(ox + dx), y: Math.round(oy + dy), width: b.width, height: b.height });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const startResize = (b: BlockIR, corner: Corner, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    drag.current = { id: b.id, corner, sx: e.clientX, sy: e.clientY, x: b.x, y: b.y, w: b.width, h: b.height };
    const move = (ev: MouseEvent) => {
      const d = drag.current; if (!d || !onResize) return;
      const dx = (ev.clientX - d.sx) / scale, dy = (ev.clientY - d.sy) / scale;
      let { x, y, w: bw, h: bh } = d;
      if (d.corner.includes('e')) bw = d.w + dx;
      if (d.corner.includes('w')) { x = d.x + dx; bw = d.w - dx; }
      if (d.corner.includes('s')) bh = d.h + dy;
      if (d.corner.includes('n')) { y = d.y + dy; bh = d.h - dy; }
      bw = Math.max(8, bw); bh = Math.max(8, bh);
      onResize(d.id, { x: Math.round(x), y: Math.round(y), width: Math.round(bw), height: Math.round(bh) });
    };
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div
      onMouseDown={() => interactive && onSelect?.(null)}
      style={{ position: 'relative', width: w, height: h, background: '#fff', boxShadow: '0 10px 28px rgba(28,48,90,.18)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}
    >
      {showRaster && page.previewImage && (
        <img src={page.previewImage} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none' }} />
      )}

      {/* shape blocks (design panels/strips) — under images & text, render-only */}
      {showBlocks && page.blocks.filter(isShapeBlock).sort((a, b) => a.zIndex - b.zIndex).map((b: ShapeBlockIR) => (
        <div key={b.id} style={{
          position: 'absolute', left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale,
          background: b.fill || 'transparent', borderRadius: (b.radius || 0) * scale,
          border: b.stroke ? `${Math.max(1, b.stroke.width * scale)}px solid ${b.stroke.color}` : undefined,
          opacity: compare ? 0.6 : 1, pointerEvents: 'none',
        }} />
      ))}

      {/* image blocks (under text) */}
      {showBlocks && page.blocks.filter(isImageBlock).map((b: ImageBlockIR) => {
        const selected = selectedId === b.id;
        return (
          <img key={b.id} src={b.src} alt="" draggable={false}
            onMouseDown={interactive ? (e) => startMove(b, e) : undefined}
            style={{
              position: 'absolute', left: b.x * scale, top: b.y * scale,
              width: b.width * scale, height: b.height * scale,
              objectFit: b.fit || 'cover', userSelect: 'none',
              opacity: compare ? 0.6 : 1,
              cursor: interactive ? (selected ? 'move' : 'pointer') : 'default',
              outline: selected ? '1.5px solid var(--accent)' : 'none',
            }} />
        );
      })}

      {showBlocks && page.blocks.filter(isTextBlock).map((b: TextBlockIR) => {
        if (interactive && editingId === b.id) {
          return <TextEditOverlay key={b.id} block={b} scale={scale} fontFamily={fontFamily}
            onChange={(t) => onChangeText?.(b.id, t)} onCommit={() => onCommit?.()} />;
        }
        const selected = selectedId === b.id;
        return (
          <div key={b.id}
            dir={b.direction === 'ltr' ? 'ltr' : 'rtl'}
            onMouseDown={interactive ? (e) => startMove(b, e) : undefined}
            onDoubleClick={interactive ? (e) => { e.stopPropagation(); onStartEdit?.(b.id); } : undefined}
            style={{
              position: 'absolute', left: b.x * scale, top: b.y * scale,
              width: b.width * scale, height: b.height * scale,
              fontSize: b.fontSize * scale, lineHeight: b.lineHeight,
              fontFamily: fontFamily || b.fontFamily, fontWeight: b.fontWeight,
              color: compare ? 'rgba(20,40,120,.55)' : b.color,
              whiteSpace: 'pre-wrap', overflow: 'hidden',
              unicodeBidi: 'plaintext',
              textAlign: b.align === 'end' ? 'right' : b.align === 'center' ? 'center' : 'left',
              cursor: interactive ? (selected ? 'move' : 'pointer') : 'default',
              outline: compare ? '1px dashed rgba(20,40,120,.4)' : selected ? '1.5px solid var(--accent)' : 'none',
              background: 'transparent',
            }}
          >{b.text}</div>
        );
      })}

      {/* resize handles on the selected (non-editing) text block */}
      {interactive && selectedId && editingId !== selectedId && (() => {
        const b = page.blocks.find((x) => x.id === selectedId);
        if (!b) return null;
        return (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
          <div key={c} onMouseDown={(e) => startResize(b, c, e)}
            style={{
              position: 'absolute', width: 10, height: 10, background: '#fff', border: '2px solid var(--accent)', borderRadius: 2, zIndex: 50,
              cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
              left: (c.includes('w') ? b.x : b.x + b.width) * scale - 5,
              top: (c.includes('n') ? b.y : b.y + b.height) * scale - 5,
            }} />
        ));
      })()}
    </div>
  );
}
