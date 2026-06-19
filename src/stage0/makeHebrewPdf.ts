// STAGE 0 (gate): prove a mixed Hebrew/English/number string round-trips through
// pdf-lib — embedded Hebrew font, correct visual order, selectable text.
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { logicalToVisual } from '../pdf/hebrew';

// The exact gate string from docs/AutoSpec-directive.md §C.2 (logical order).
export const GATE_STRING = 'פיג\'ו 3008 EV · 130 כ"ס · 1.2L';

export async function makeHebrewPdf(fontBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // subset:false — pdf-lib's CFF/OTF subsetting corrupts this font for strict renderers
  // (FreeType/MuPDF fail to load the subset and Hebrew glyphs vanish). Full embed renders
  // correctly. Revisit subsetting later with a TTF or a fixed subsetter (Stage 6 concern).
  const font = await doc.embedFont(fontBytes, { subset: false });

  const page = doc.addPage([595, 240]);
  const W = page.getWidth();
  const margin = 40;
  const ink = rgb(0.07, 0.07, 0.09);

  // Label (LTR)
  page.drawText('AutoSpec Studio — Stage 0 PDF gate', { x: margin, y: 205, size: 12, font, color: rgb(0.4, 0.4, 0.45) });

  // The Hebrew gate line: reorder logical -> visual, draw right-aligned (RTL).
  const size = 30;
  const visual = logicalToVisual(GATE_STRING, 'rtl');
  const tw = font.widthOfTextAtSize(visual, size);
  page.drawText(visual, { x: W - margin - tw, y: 140, size, font, color: ink });

  // A second, longer mixed line to stress bidi (Hebrew + Latin + digits + punctuation).
  const line2 = 'מנוע 1.2 PureTech · תיבה אוטומטית · 130 כ"ס (EV6)';
  const v2 = logicalToVisual(line2, 'rtl');
  const s2 = 18;
  const tw2 = font.widthOfTextAtSize(v2, s2);
  page.drawText(v2, { x: W - margin - tw2, y: 95, size: s2, font, color: rgb(0.25, 0.27, 0.3) });

  return await doc.save();
}
