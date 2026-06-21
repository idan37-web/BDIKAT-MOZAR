// Lightweight IR → thumbnail raster, so GENERATED catalog pages (which have no source
// previewImage) show their real layout in the page rail instead of a blank white page.
// Draws shapes, table cells, text, and image placeholders to a small canvas (synchronous).
import type { PageIR } from '../types/catalog';
import { isShapeBlock, isImageBlock, isTableBlock, isTextBlock, columnLeftFraction } from '../types/catalog';

export function renderThumbnail(page: PageIR, fontFamily: string, maxW = 260): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const scale = Math.min(maxW / page.width, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(page.width * scale));
  c.height = Math.max(1, Math.round(page.height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  const ordered = [...page.blocks].filter((b) => !b.deleted).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  for (const b of ordered) {
    if (isShapeBlock(b)) {
      ctx.fillStyle = b.fill || '#e9eaee';
      ctx.fillRect(b.x * scale, b.y * scale, Math.max(1, b.width * scale), Math.max(1, b.height * scale));
    } else if (isImageBlock(b)) {
      // a neutral placeholder (loading the real image would be async) — shows the layout slot
      ctx.fillStyle = '#dfe2e7';
      ctx.fillRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
    } else if (isTableBlock(b)) {
      if (b.cellBg) { ctx.fillStyle = b.cellBg; ctx.fillRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale); }
      const rh = (b.rows.length ? b.height / b.rows.length : b.rowHeight);
      ctx.fillStyle = b.color || '#111418';
      const fs = Math.max(4, (b.fontSize || 9) * scale);
      ctx.font = `${fs}px ${fontFamily}`;
      ctx.direction = 'rtl';
      b.rows.forEach((row, r) => {
        const y = (b.y + r * rh) * scale + fs;
        if (row.kind === 'section') { ctx.textAlign = 'right'; ctx.fillText(row.cells[0] || '', (b.x + b.width) * scale - 2, y); return; }
        for (let col = 0; col < b.columns; col++) {
          const lf = columnLeftFraction(b.colFractions, col);
          const cx = (b.x + lf * b.width) * scale;
          const cw = (b.colFractions[col] || 0) * b.width * scale;
          const txt = (row.cells[col] ?? '').slice(0, 24);
          if (!txt) continue;
          if (col === 0) { ctx.textAlign = 'right'; ctx.fillText(txt, cx + cw - 2, y); }
          else { ctx.textAlign = 'center'; ctx.fillText(txt, cx + cw / 2, y); }
        }
      });
    } else if (isTextBlock(b)) {
      ctx.fillStyle = b.color || '#111418';
      const fs = Math.max(4, b.fontSize * scale);
      ctx.font = `${b.fontWeight >= 600 ? '700 ' : ''}${fs}px ${fontFamily}`;
      ctx.direction = b.direction === 'ltr' ? 'ltr' : 'rtl';
      ctx.textAlign = b.align === 'center' ? 'center' : b.align === 'start' ? (b.direction === 'ltr' ? 'left' : 'right') : (b.direction === 'ltr' ? 'left' : 'right');
      const x = b.align === 'center' ? (b.x + b.width / 2) * scale : b.direction === 'ltr' && b.align === 'start' ? b.x * scale : (b.x + b.width) * scale;
      const line = (b.text || '').split('\n')[0].slice(0, 60);
      try { ctx.fillText(line, x, b.y * scale + fs); } catch { /* skip */ }
    }
  }
  ctx.textAlign = 'left'; ctx.direction = 'ltr';
  return c.toDataURL('image/jpeg', 0.72);
}

/** Fill in previewImage for any page that lacks one (generated catalogs). */
export function ensureThumbnails(pages: PageIR[], fontFamily: string): void {
  for (const p of pages) if (!p.previewImage) p.previewImage = renderThumbnail(p, fontFamily);
}
