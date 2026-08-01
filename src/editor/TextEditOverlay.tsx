// Stage 3 (C.5): in-place text editing via a <textarea> in SCREEN coordinates.
// The textarea matches the block's font/size/align/direction and wraps inside the
// block's width (text never escapes the box; the box does not move). Live updates;
// commit on blur/Escape. No contentEditable, no transform-scale caret issues.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextBlockIR } from '../types/catalog';
import { blockScreenRect } from './coords';

export function TextEditOverlay({
  block, scale, fontFamily, onChange, onCommit,
}: {
  block: TextBlockIR;
  scale: number;
  fontFamily?: string;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [overflow, setOverflow] = useState(false);
  const r = blockScreenRect(block, scale);

  useEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [block.text, block.width, block.height, scale]);

  return (
    <>
      <textarea
        ref={ref}
        dir={block.direction === 'ltr' ? 'ltr' : 'rtl'}
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCommit(); } }}
        style={{
          // transparent: no auto background/mask — the IR is the only layer here
          position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height,
          margin: 0, padding: 0, border: 'none', resize: 'none', background: 'transparent',
          fontSize: block.fontSize * scale, lineHeight: block.lineHeight,
          fontFamily: fontFamily || block.fontFamily, fontWeight: block.fontWeight, color: block.color,
          textAlign: block.align === 'end' ? 'right' : block.align === 'center' ? 'center' : 'left',
          unicodeBidi: 'plaintext', outline: '1.5px solid var(--accent)', overflow: 'hidden',
          zIndex: 1000, whiteSpace: 'pre-wrap',
        }}
      />
      {overflow && (
        <div style={{ position: 'absolute', left: r.left, top: r.top - 18, zIndex: 1001, fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--warn)', borderRadius: 5, padding: '1px 7px' }}>
          הטקסט חורג מהתיבה — הגדל את הגובה
        </div>
      )}
    </>
  );
}
