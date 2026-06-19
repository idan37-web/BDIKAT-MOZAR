// Stage 4 (C.6): real VECTOR export. Walk the PageIR and draw to a pdf-lib document
// with an embedded Hebrew font. pdf-lib does no bidi → reorder logical->visual (Stage 0
// utility) before drawing. Text is real/selectable vector text, never a rasterized page.
import { PDFDocument, rgb, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { logicalToVisual } from './hebrew';
import type { DocumentIR, TextBlockIR } from '../types/catalog';
import { isTextBlock } from '../types/catalog';

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.07, 0.07, 0.09);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function exportPdf(doc: DocumentIR, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false }); // full embed (Stage 0 finding)

  for (const page of doc.pages) {
    const p = pdf.addPage([page.width, page.height]);
    for (const b of page.blocks) {
      if (!isTextBlock(b) || b.deleted) continue;
      const tb = b as TextBlockIR;
      const size = tb.fontSize;
      const color = hexToRgb(tb.color);
      const lineGap = size * (tb.lineHeight || 1.2);
      const lines = tb.text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        if (!raw) continue;
        const visual = logicalToVisual(raw, tb.direction === 'ltr' ? 'ltr' : 'rtl');
        const tw = font.widthOfTextAtSize(visual, size);
        // horizontal alignment within the block box
        let x = tb.x;
        if (tb.direction === 'rtl' || tb.align === 'end') x = tb.x + tb.width - tw;
        else if (tb.align === 'center') x = tb.x + (tb.width - tw) / 2;
        // top-left IR origin -> pdf-lib bottom-left baseline
        const y = page.height - tb.y - size * 0.85 - li * lineGap;
        // Draw glyph-by-glyph at explicit x. We already reordered to VISUAL order, and
        // positioning each glyph absolutely prevents the PDF VIEWER from re-applying
        // bidi (which would otherwise reverse numbers / flip the line when it starts
        // with a Hebrew char). This guarantees the on-screen order across viewers.
        let cx = x;
        for (const ch0 of visual) {
          // Hebrew punctuation the brand font lacks → ASCII equivalents (avoid .notdef box)
          const ch = ch0 === '׳' ? "'" : ch0 === '״' ? '"' : ch0;
          const w = font.widthOfTextAtSize(ch, size);
          if (ch !== ' ') {
            try { p.drawText(ch, { x: cx, y, size, font, color }); } catch { /* skip unencodable */ }
          }
          cx += w;
        }
      }
    }
  }
  return await pdf.save();
}
