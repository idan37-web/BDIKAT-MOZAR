// Stage 4 (C.6) + Phase/Milestone A: real VECTOR export. Walk the PageIR and draw to a
// pdf-lib document with an embedded Hebrew font. pdf-lib does no bidi → reorder
// logical->visual (Stage 0 utility) before drawing. Text is real/selectable vector text;
// images are embedded at full source resolution (no downsampling) and clipped to their
// box for cover/crop. Never a rasterized page.
import {
  PDFDocument, rgb, type RGB, type PDFImage, type PDFPage,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
  translate, scale, rotateDegrees,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { logicalToVisual } from './hebrew';
import { wrapText } from '../catalog/autofit';
import { drawLineOutlines, openFont } from '../engine/glyphExport';

type OutlineFont = ReturnType<typeof openFont>;
import type { DocumentIR, TextBlockIR, ImageBlockIR, ShapeBlockIR, TableBlockIR, BlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock, isTableBlock, columnLeftFraction } from '../types/catalog';

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
    opacity: b.opacity != null ? b.opacity : undefined,
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
  // crop = source-fraction window to SHOW: scale the image so that window fills the box, clip the rest.
  const cr = b.crop && b.crop.fw > 0 && b.crop.fh > 0 ? b.crop : null;
  if (cr) {
    const dW = b.width / cr.fw, dH = b.height / cr.fh;
    const dX = b.x - cr.fx * dW;
    const dYb = pageH - b.y - dH + cr.fy * dH; // bottom-left of the full image
    page.pushOperators(pushGraphicsState(), rectangle(b.x, boxBottom, b.width, b.height), clip(), endPath());
    if (b.flipH) page.pushOperators(translate(b.x + b.width / 2, 0), scale(-1, 1), translate(-(b.x + b.width / 2), 0));
    page.drawImage(img, { x: dX, y: dYb, width: dW, height: dH, opacity: b.opacity != null ? b.opacity : undefined });
    page.pushOperators(popGraphicsState());
    if (b.stroke && b.stroke.width > 0) {
      page.drawRectangle({ x: b.x, y: boxBottom, width: b.width, height: b.height, borderColor: hexToRgb(b.stroke.color), borderWidth: b.stroke.width });
    }
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
  void drawX; void drawY;

  // Clip to the axis-aligned box (page space), then transform around the box CENTRE so rotation /
  // horizontal flip render correctly and stay clipped to the slot. Image is drawn centred.
  const cx = b.x + b.width / 2;
  const cy = pageH - (b.y + b.height / 2);
  page.pushOperators(pushGraphicsState(), rectangle(b.x, boxBottom, b.width, b.height), clip(), endPath());
  page.pushOperators(translate(cx, cy));
  if (b.rotation) page.pushOperators(rotateDegrees(-b.rotation));
  if (b.flipH) page.pushOperators(scale(-1, 1));
  page.drawImage(img, { x: -drawW / 2, y: -drawH / 2, width: drawW, height: drawH, opacity: b.opacity != null ? b.opacity : undefined });
  page.pushOperators(popGraphicsState());

  // optional axis-aligned frame around the slot box (drawn after, so it sits on top)
  if (b.stroke && b.stroke.width > 0) {
    page.drawRectangle({
      x: b.x, y: boxBottom, width: b.width, height: b.height,
      borderColor: hexToRgb(b.stroke.color), borderWidth: b.stroke.width,
    });
  }
}

/**
 * Decide how a text block is drawn. A SINGLE-LINE box must NOT wrap: the imported box width was
 * measured in the ORIGINAL font, and our embedded font is slightly wider, so wrapping would push a
 * 2nd line down onto the next block (the doubling/overlap bug). For a single-line box we keep the
 * whole line and shrink slightly to fit the width; taller boxes wrap and clip extra rows (the editor
 * clips too via overflow:hidden). Pure + exported so a gate can lock the behaviour.
 */
export function planTextLines(
  text: string, width: number, height: number, fontSize: number, lineHeight: number, measure: (t: string, s: number) => number,
): { lines: string[]; drawSize: number } {
  const lineGap = fontSize * (lineHeight || 1.2);
  const maxLines = Math.max(1, Math.floor((height + fontSize * 0.35) / lineGap));
  if (maxLines <= 1) {
    const one = text.replace(/\s*\n\s*/g, ' ');
    const floor = fontSize * 0.72;
    let drawSize = fontSize;
    while (drawSize > floor && measure(one, drawSize) > width) drawSize = Math.max(floor, drawSize - 0.25);
    return { lines: [one], drawSize };
  }
  // F2: an IMPORTED multi-line block carries the SOURCE's own line breaks — draw them verbatim.
  // Re-wrapping with the (wider) embedded font split a source line in two and the tail line was
  // sliced off ("סרקו את הברקוד" vanished from the dealer strip); the per-line advance squeeze
  // guarantees each stored line fits the box width.
  if (text.includes('\n')) {
    return { lines: text.split('\n'), drawSize: fontSize };
  }
  let lines = wrapText(text, width, fontSize, measure);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  return { lines, drawSize: fontSize };
}

function drawTextBlock(page: PDFPage, pageH: number, tb: TextBlockIR, font: Awaited<ReturnType<PDFDocument['embedFont']>>, outlineFont?: OutlineFont): void {
  const size = tb.fontSize;
  const color = hexToRgb(tb.color);
  // rotated run (vertical sidebar): rotate the page CTM around the baseline-left point —
  // matches the editor's transformOrigin — and draw the single line at the local origin.
  if (tb.rotation) {
    const visual = logicalToVisual(tb.text.replace(/\s*\n\s*/g, ' '), tb.direction === 'ltr' ? 'ltr' : 'rtl');
    page.pushOperators(pushGraphicsState(), translate(tb.x, pageH - tb.y - size * 0.85), rotateDegrees(-tb.rotation));
    drawVisualLine(page, 0, 0, visual, size, font, color);
    page.pushOperators(popGraphicsState());
    return;
  }
  const measure = (t: string, s: number) => font.widthOfTextAtSize(t, s);
  const { lines, drawSize } = planTextLines(tb.text, tb.width, tb.height, size, tb.lineHeight || 1.2, measure);
  const drawGap = drawSize * (tb.lineHeight || 1.2);
  // F2 baseline parity: an IMPORTED block's top is the source glyph top minus the source ascent
  // (≈ fontSize), so the source baseline sits ≈1.0×size below our top; drawing at 0.85 floated
  // every unedited run ~0.15em above the original (edge chars leaked into neighbouring regions).
  // Generated/user content keeps the editor-calibrated 0.85.
  const baselineK = tb.source === 'original' ? 1.0 : 0.85;
  // clip every text block to its box so nothing ever bleeds onto a neighbour (WYSIWYG safety net)
  const clipBottom = pageH - tb.y - tb.height;
  page.pushOperators(pushGraphicsState(), rectangle(tb.x - 0.5, clipBottom - 0.5, tb.width + 1, tb.height + 1), clip(), endPath());
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    if (!raw) continue;
    const visual = logicalToVisual(raw, tb.direction === 'ltr' ? 'ltr' : 'rtl');
    const tw = font.widthOfTextAtSize(visual, drawSize);
    let x = tb.x;
    if (tb.direction === 'rtl' || tb.align === 'end') x = tb.x + tb.width - tw;
    else if (tb.align === 'center') x = tb.x + (tb.width - tw) / 2;
    const y = pageH - tb.y - drawSize * baselineK - li * drawGap;
    // T5 (gated): outline mode draws the line as vector glyph PATHS — viewer-independent print
    // masters (no selectable text). Default remains glyph-by-glyph text draws.
    if (outlineFont) {
      drawLineOutlines(page, outlineFont, visual, x, y, drawSize, color);
      continue;
    }
    // Draw glyph-by-glyph at explicit x: we already reordered to VISUAL order, and
    // positioning each glyph absolutely prevents the PDF VIEWER from re-applying bidi
    // (which would otherwise reverse numbers / flip a line that starts with Hebrew).
    // F2: when the embedded font runs slightly WIDER than the source font, squeeze the
    // inter-glyph advances so the line always stays inside its box (a cut final digit —
    // "1,151"→"1,15" — is a round-trip fidelity failure).
    const squeeze = tw > tb.width + 0.3 && tw > 0 ? (tb.width + 0.3) / tw : 1;
    if (squeeze < 1 && (tb.direction === 'rtl' || tb.align === 'end')) x = tb.x + tb.width - tw * squeeze;
    let cx = x;
    for (const ch0 of visual) {
      const { ch, w } = encodableGlyph(font, ch0, drawSize);
      if (ch !== ' ') {
        try { page.drawText(ch, { x: cx, y, size: drawSize, font, color }); } catch { /* skip unencodable */ }
      }
      cx += w * squeeze;
    }
  }
  page.pushOperators(popGraphicsState());
}

/** F2: prefer the ORIGINAL character (geresh ׳, gershayim ״, …); substitute only when the
 * embedded font cannot encode it — a hard substitution broke source-identity round-trips. */
const GLYPH_FALLBACK: Record<string, string> = { '׳': "'", '״': '"', '–': '-', '—': '-' };
function encodableGlyph(font: EmbeddedFont, ch0: string, size: number): { ch: string; w: number } {
  try { return { ch: ch0, w: font.widthOfTextAtSize(ch0, size) }; }
  catch {
    const alt = GLYPH_FALLBACK[ch0] ?? ch0;
    try { return { ch: alt, w: font.widthOfTextAtSize(alt, size) }; }
    catch { return { ch: ' ', w: size * 0.25 }; }
  }
}

type EmbeddedFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/** Draw a single visual-ordered line, glyph-by-glyph at explicit x (defeats viewer re-bidi). */
function drawVisualLine(page: PDFPage, xStart: number, y: number, visual: string, size: number, font: EmbeddedFont, color: RGB): void {
  let cx = xStart;
  for (const ch0 of visual) {
    const { ch, w } = encodableGlyph(font, ch0, size);
    if (ch !== ' ') { try { page.drawText(ch, { x: cx, y, size, font, color }); } catch { /* skip */ } }
    cx += w;
  }
}

/** Draw a TableBlockIR as vector cells + gridlines (matches the editor's grid). */
function drawTableBlock(page: PDFPage, pageH: number, tb: TableBlockIR, font: EmbeddedFont, fontBold: EmbeddedFont): void {
  const color = hexToRgb(tb.color);
  const heading = hexToRgb(tb.headingColor || tb.color);
  const grid = hexToRgb(tb.gridColor || '#d7dade');
  const pad = 3;
  if (tb.cellBg) page.drawRectangle({ x: tb.x, y: pageH - tb.y - tb.height, width: tb.width, height: tb.height, color: hexToRgb(tb.cellBg) });
  const cellText = (text: string, cellX: number, cellW: number, rowTop: number, align: 'end' | 'center', size: number, col: RGB, bold?: boolean) => {
    if (!text) return;
    const f = bold ? fontBold : font;
    const visual = logicalToVisual(text, 'rtl');
    const tw = f.widthOfTextAtSize(visual, size);
    const xStart = align === 'center' ? cellX + (cellW - tw) / 2 : cellX + cellW - pad - tw;
    const y = pageH - rowTop - tb.rowHeight / 2 - size * 0.34;
    drawVisualLine(page, xStart, y, visual, size, f, col);
  };

  for (let r = 0; r < tb.rows.length; r++) {
    const row = tb.rows[r];
    const rowTop = tb.y + r * tb.rowHeight;
    const size = tb.fontSize;
    if (row.kind === 'section') {
      if (tb.sectionBg) page.drawRectangle({ x: tb.x, y: pageH - rowTop - tb.rowHeight, width: tb.width, height: tb.rowHeight, color: hexToRgb(tb.sectionBg) });
      cellText(row.cells[0] || '', tb.x, tb.width, rowTop, 'end', size, heading, true);
    } else {
      for (let i = 0; i < tb.columns; i++) {
        const leftFrac = columnLeftFraction(tb.colFractions, i);
        const cellX = tb.x + leftFrac * tb.width;
        const cellW = (tb.colFractions[i] || 0) * tb.width;
        const text = row.cells[i] ?? '';
        const isLabel = i === 0;
        const head = row.kind === 'header';
        cellText(text, cellX, cellW, rowTop, isLabel ? 'end' : 'center', size, head ? heading : color, head);
      }
    }
    // horizontal rule under the row
    const ry = pageH - (rowTop + tb.rowHeight);
    page.drawRectangle({ x: tb.x, y: ry, width: tb.width, height: 0.4, color: grid });
  }
  // vertical separators between columns (boundary = left edge of the right-hand column)
  const top = pageH - tb.y;
  for (let i = 1; i < tb.columns; i++) {
    const bx = tb.x + columnLeftFraction(tb.colFractions, i - 1) * tb.width;
    page.drawRectangle({ x: bx, y: top - tb.height, width: 0.4, height: tb.height, color: grid });
  }
}

export interface ExportOptions {
  /** 'text' (default): selectable glyph-positioned text. 'outlines' (T5, gated): every text run
   * drawn as vector glyph paths — viewer-independent print master, not selectable. */
  exportMode?: 'text' | 'outlines';
}

export async function exportPdf(doc: DocumentIR, fontBytes: Uint8Array, boldBytes?: Uint8Array, opts: ExportOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false }); // full embed (Stage 0 finding)
  // bold variant for bold text/headings; falls back to regular when no bold font is supplied
  const fontBold = boldBytes ? await pdf.embedFont(boldBytes, { subset: false }) : font;
  const outlineFont = opts.exportMode === 'outlines' ? openFont(fontBytes) : undefined;
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
      } else if (isTableBlock(b)) {
        drawTableBlock(p, page.height, b, font, fontBold);
      } else if (isTextBlock(b)) {
        drawTextBlock(p, page.height, b, (b.fontWeight ?? 400) >= 600 ? fontBold : font, outlineFont);
      }
    }
  }
  return await pdf.save();
}
