// Stage 4 (C.6) + Phase/Milestone A: real VECTOR export. Walk the PageIR and draw to a
// pdf-lib document with an embedded Hebrew font. pdf-lib does no bidi → reorder
// logical->visual (Stage 0 utility) before drawing. Text is real/selectable vector text;
// images are embedded at full source resolution (no downsampling) and clipped to their
// box for cover/crop. Never a rasterized page.
import {
  PDFDocument, rgb, type RGB, type PDFImage, type PDFPage,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { logicalToVisual } from './hebrew';
import { wrapText } from '../catalog/autofit';
import type { DocumentIR, TextBlockIR, ImageBlockIR, ShapeBlockIR, BlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock } from '../types/catalog';

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.07, 0.07, 0.09);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  // Node verification path
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

interface ParsedDataUrl { mime: string; bytes: Uint8Array; }
function parseDataUrl(src: string): ParsedDataUrl | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const isB64 = !!m[2];
  const bytes = isB64 ? base64ToBytes(m[3]) : new Uint8Array([...decodeURIComponent(m[3])].map((c) => c.charCodeAt(0)));
  return { mime, bytes };
}

// Embed each distinct source once (a generated catalog reuses the same asset across pages).
async function embedImage(pdf: PDFDocument, src: string, cache: Map<string, PDFImage | null>): Promise<PDFImage | null> {
  if (cache.has(src)) return cache.get(src)!;
  let img: PDFImage | null = null;
  const parsed = parseDataUrl(src);
  if (parsed) {
    try {
      if (parsed.mime === 'image/png') img = await pdf.embedPng(parsed.bytes);
      else if (parsed.mime === 'image/jpeg' || parsed.mime === 'image/jpg') img = await pdf.embedJpg(parsed.bytes);
      // SVG placeholders / other mimes: not embeddable as raster → drawn as an empty frame
    } catch { img = null; }
  }
  cache.set(src, img);
  return img;
}

/** Draw a filled shape (design panel/strip) as a vector rectangle. */
function drawShapeBlock(page: PDFPage, pageH: number, b: ShapeBlockIR): void {
  const y = pageH - b.y - b.height;
  page.drawRectangle({
    x: b.x, y, width: b.width, height: b.height,
    color: b.fill ? hexToRgb(b.fill) : undefined,
    borderColor: b.stroke ? hexToRgb(b.stroke.color) : undefined,
    borderWidth: b.stroke ? b.stroke.width : undefined,
  });
}

/** Draw an image block, embedding at full resolution and clipping to its box. */
function drawImageBlock(page: PDFPage, pageH: number, b: ImageBlockIR, img: PDFImage | null): void {
  const boxBottom = pageH - b.y - b.height; // pdf-lib bottom-left origin
  if (!img) {
    // unembeddable (e.g. an unbound placeholder) → neutral frame so layout is visible
    page.drawRectangle({ x: b.x, y: boxBottom, width: b.width, height: b.height, color: rgb(0.92, 0.92, 0.93) });
    return;
  }
  const iw = img.width;
  const ih = img.height;
  const fit = b.fit || 'cover';
  let drawW = b.width;
  let drawH = b.height;
  let drawX = b.x;
  let drawY = boxBottom;
  if (fit === 'contain') {
    const s = Math.min(b.width / iw, b.height / ih);
    drawW = iw * s; drawH = ih * s;
    drawX = b.x + (b.width - drawW) / 2;
    drawY = boxBottom + (b.height - drawH) / 2;
  } else if (fit === 'cover') {
    const s = Math.max(b.width / iw, b.height / ih);
    drawW = iw * s; drawH = ih * s;
    drawX = b.x + (b.width - drawW) / 2;
    drawY = boxBottom + (b.height - drawH) / 2;
  } // 'fill' → stretch to the box (drawW/H already = box)

  const needsClip = fit === 'cover' || drawW > b.width + 0.5 || drawH > b.height + 0.5;
  if (needsClip) {
    page.pushOperators(pushGraphicsState(), rectangle(b.x, boxBottom, b.width, b.height), clip(), endPath());
  }
  page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
  if (needsClip) page.pushOperators(popGraphicsState());
}

function drawTextBlock(page: PDFPage, pageH: number, tb: TextBlockIR, font: Awaited<ReturnType<PDFDocument['embedFont']>>): void {
  const size = tb.fontSize;
  const color = hexToRgb(tb.color);
  const lineGap = size * (tb.lineHeight || 1.2);
  // wrap to the box width (matches the DOM editor) so long lines never overflow horizontally
  const measure = (t: string, s: number) => font.widthOfTextAtSize(t, s);
  const lines = wrapText(tb.text, tb.width, size, measure);
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw) continue;
    const visual = logicalToVisual(raw, tb.direction === 'ltr' ? 'ltr' : 'rtl');
    const tw = font.widthOfTextAtSize(visual, size);
    let x = tb.x;
    if (tb.direction === 'rtl' || tb.align === 'end') x = tb.x + tb.width - tw;
    else if (tb.align === 'center') x = tb.x + (tb.width - tw) / 2;
    const y = pageH - tb.y - size * 0.85 - li * lineGap;
    // Draw glyph-by-glyph at explicit x: we already reordered to VISUAL order, and
    // positioning each glyph absolutely prevents the PDF VIEWER from re-applying bidi
    // (which would otherwise reverse numbers / flip a line that starts with Hebrew).
    let cx = x;
    for (const ch0 of visual) {
      const ch = ch0 === '׳' ? "'" : ch0 === '״' ? '"' : ch0;
      const w = font.widthOfTextAtSize(ch, size);
      if (ch !== ' ') {
        try { page.drawText(ch, { x: cx, y, size, font, color }); } catch { /* skip unencodable */ }
      }
      cx += w;
    }
  }
}

export async function exportPdf(doc: DocumentIR, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false }); // full embed (Stage 0 finding)
  const imgCache = new Map<string, PDFImage | null>();

  for (const page of doc.pages) {
    const p = pdf.addPage([page.width, page.height]);
    // paint order: ascending zIndex (images sit under text)
    const ordered: BlockIR[] = [...page.blocks].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    for (const b of ordered) {
      if (b.deleted) continue;
      if (isShapeBlock(b)) {
        drawShapeBlock(p, page.height, b);
      } else if (isImageBlock(b)) {
        const img = await embedImage(pdf, b.src, imgCache);
        drawImageBlock(p, page.height, b, img);
      } else if (isTextBlock(b)) {
        drawTextBlock(p, page.height, b, font);
      }
    }
  }
  return await pdf.save();
}
