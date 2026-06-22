// Layers / elements checklist for the current page. Lists every block (incl. ones hidden
// behind text), shows which are selected, and lets the user toggle each from a checklist —
// the reliable way to select/deselect a background, table or shape sitting under other objects.
import type { BlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isTableBlock, isShapeBlock } from '../types/catalog';

function describe(b: BlockIR): { icon: string; label: string; swatch?: string } {
  if (isTextBlock(b)) return { icon: 'T', label: (b.text || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'טקסט ריק' };
  if (isImageBlock(b)) return { icon: '🖼', label: 'תמונה' };
  if (isTableBlock(b)) return { icon: '▦', label: `טבלה · ${b.rows.length} שורות` };
  if (isShapeBlock(b)) return { icon: '◼', label: b.type === 'background' ? 'רקע' : 'צורה', swatch: b.fill };
  return { icon: '·', label: b.type };
}

export function LayersPanel({ blocks, selectedIds, onToggle, onSelectOnly, onClear, onHover }: {
  blocks: BlockIR[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectOnly: (id: string) => void;
  onClear: () => void;
  onHover?: (id: string | null) => void;
}) {
  // top-most first (matches what the user sees on top)
  const ordered = [...blocks].filter((b) => !b.deleted).sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  return (
    <div style={{ width: 230, flexShrink: 0, borderInlineEnd: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>שכבות ({ordered.length})</strong>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--accent-ink, var(--accent))' }}>{selectedIds.size} נבחרו</span>
        {selectedIds.size > 0 && <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={onClear}>נקה</button>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {ordered.map((b) => {
          const d = describe(b);
          const on = selectedIds.has(b.id);
          return (
            <div key={b.id}
              onMouseEnter={() => onHover?.(b.id)} onMouseLeave={() => onHover?.(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 7, cursor: 'pointer', background: on ? 'var(--accent-soft, rgba(232,120,30,.14))' : 'transparent', marginBottom: 2 }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(b.id)} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }} />
              <button onClick={() => onSelectOnly(b.id)} title={d.label}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 0, textAlign: 'start' }}>
                {d.swatch ? <span style={{ width: 13, height: 13, borderRadius: 3, background: d.swatch, border: '1px solid var(--line-2)', flexShrink: 0 }} />
                  : <span style={{ width: 15, textAlign: 'center', flexShrink: 0, fontSize: 12, color: 'var(--ink-3)' }}>{d.icon}</span>}
                <span dir="rtl" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: on ? 'var(--ink)' : 'var(--ink-2)' }}>{d.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
