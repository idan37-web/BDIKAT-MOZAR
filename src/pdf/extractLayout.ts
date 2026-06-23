// Stage 2 (C.4): extract a pdf.js page's text into TextBlockIR (PDF points, top-left
// origin, LOGICAL order). pdf.js returns text items in logical order with a `dir`
// flag and a transform matrix in bottom-left PDF user space — we convert to our
// top-left point coordinates. No bidi reordering here: the IR stores logical text.
import type { TextBlockIR } from '../types/catalog';

interface PdfTextItem {
  str: string;
  dir: string; // 'ltr' | 'rtl' | 'ttb'
  width: number;
  height: number;
  transform: number[]; // [a,b,c,d,e,f]
  fontName?: string;
}
interface PdfTextContent { items: PdfTextItem[]; }

function dirOf(item: PdfTextItem): TextBlockIR['direction'] {
  if (item.dir === 'rtl') return 'rtl';
  if (item.dir === 'ltr') return 'ltr';
  return 'mixed';
}

/**
 * @param textContent  result of page.getTextContent()
 * @param pageHeight   page height in PDF points (for origin flip)
 * @param resolveFont  maps a pdf.js loadedName (e.g. "g_d0_f3") to the REAL font's
 *   { name, bold } via page.commonObjs — needed because the item's own `fontName` is an
 *   internal key that never reveals weight, and the parsed font carries a reliable bold flag.
 */
export function extractTextBlocks(
  textContent: PdfTextContent,
  pageHeight: number,
  pageId: string,
  resolveFont?: (loadedName?: string) => { name?: string; bold?: boolean } | undefined,
): TextBlockIR[] {
  const blocks: TextBlockIR[] = [];
  let z = 1;
  for (let i = 0; i < textContent.items.length; i++) {
    const it = textContent.items[i];
    const str = it.str;
    if (!str || !str.trim()) continue;

    const t = it.transform;
    const size = Math.hypot(t[0], t[1]) || it.height || 10;
    const left = t[4];
    // pdf.js baseline y (bottom-left). Convert the glyph box top to top-left origin.
    const ascent = it.height || size;
    const top = pageHeight - t[5] - ascent;

    const info = resolveFont?.(it.fontName);
    const realName = info?.name || it.fontName;
    // bold from the parsed font's own flag (most reliable) OR a broad weight-word/number in the name
    const nameBold = /bold|black|heavy|semibold|demibold|extrabold|\bbd\b|\bblk\b|\bw[7-9]\b|[6-9]00/i.test(realName || '');
    const weight = info?.bold || nameBold ? 700 : 400;

    blocks.push({
      id: `${pageId}_t${i}`,
      type: 'text',
      x: round(left),
      y: round(top),
      width: round(it.width),
      height: round(it.height || size * 1.2),
      rotation: 0,
      zIndex: z++,
      source: 'original',
      originalBBox: { x: round(left), y: round(top), width: round(it.width), height: round(it.height || size * 1.2) },
      text: str,
      originalText: str,
      fontFamily: cleanFontName(realName),
      fontSize: round1(size),
      fontWeight: weight,
      lineHeight: 1.2,
      color: '#111418', // pdf.js text content has no color; refined later via op-list
      direction: dirOf(it),
      align: dirOf(it) === 'rtl' ? 'end' : 'start',
    });
  }
  return blocks;
}

function round(n: number): number { return Math.round(n); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function cleanFontName(n?: string): string {
  if (!n) return 'sans-serif';
  // strip pdf.js subset prefixes like "g_d0_f1" / "ABCDEF+Name"
  return n.replace(/^[A-Z]{6}\+/, '').replace(/^g_d\d+_f\d+$/, 'sans-serif');
}
