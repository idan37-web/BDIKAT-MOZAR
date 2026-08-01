// Stage 2 (C.4): extract a pdf.js page's text into TextBlockIR (PDF points, top-left
// origin, LOGICAL order). pdf.js returns text items in logical order with a `dir`
// flag and a transform matrix in bottom-left PDF user space — we convert to our
// top-left point coordinates. No bidi reordering here: the IR stores logical text.
import type { TextBlockIR } from '../types/catalog';
import { reconstruct, type ReconUnit } from '../engine/textRecon';
import { repairReversedBrackets } from '../engine/bidi';

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
 * F3 (letter-spaced small print): pdf.js bakes a run's letter-spacing into its `str` as one
 * space per glyph — a dealer strip phone arrives as "0 3 - 6 7 1 0 3 5 4", an address as
 * "ש ו ר ק ר א ש ל ״ צ :". Those spaces are typographic, not word breaks, so they must be
 * removed or the word/phone splits into a character soup. Detection is statistical, not a
 * fixed threshold: a run is letter-spaced when most of its space-separated tokens are single
 * characters. Normal multi-word runs ("רכב קומפקטי שמביא", "דרגת זיהום אוויר") keep every
 * space. Scale widgets whose glyphs are SEPARATE pdf.js items ("1" "2" "3") are handled later,
 * between units, by the reconstruction engine's gap classifier — this only touches intra-run
 * spacing that is already collapsed into a single string here.
 */
export function collapseLetterSpacing(str: string): string {
  if (!str.includes(' ')) return str;
  const tokens = str.split(/ +/).filter(Boolean);
  if (tokens.length < 4) return str; // too short to classify reliably
  const singles = tokens.filter((t) => [...t].length === 1).length;
  if (singles < tokens.length * 0.6) return str; // real words, not letter-spacing
  return tokens.join('');
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
    const str = collapseLetterSpacing(it.str);
    if (!str || !str.trim()) continue;

    const t = it.transform;
    const size = Math.hypot(t[0], t[1]) || it.height || 10;
    const left = t[4];
    // pdf.js baseline y (bottom-left). Convert the glyph box top to top-left origin.
    const ascent = it.height || size;
    const top = pageHeight - t[5] - ascent;
    // real glyph boxes are ~1.3× the nominal size (ascender+descender); a box of exactly
    // `size` visually clips descenders in the editor (measured vs PyMuPDF: true ≈ 1.38×).
    const boxH = (it.height || size) * 1.3;
    // rotated text (a vertical sidebar like "10/2025"): angle from the text matrix. Stored on the
    // block and rendered rotated in the editor (was drawn horizontal → overlapped the layout).
    const angleDeg = Math.round(Math.atan2(t[1], t[0]) * 180 / Math.PI);

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
      height: round(boxH),
      rotation: angleDeg !== 0 ? -angleDeg : 0, // CSS rotates clockwise; PDF angle is CCW

      zIndex: z++,
      source: 'original',
      originalBBox: { x: round(left), y: round(top), width: round(it.width), height: round(boxH) },
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

// ---------------------------------------------------------------------------
// Import-time clustering: raw pdf.js runs → LINES → PARAGRAPHS.
// pdf.js emits one item per show-text run (often a single word), so a paragraph
// arrives as dozens of blocks. We merge in LOGICAL (content-stream) order — never
// by x — so bidi is untouched (reordering happens only at render/export).
// ---------------------------------------------------------------------------


/** ReconUnit adapter carrying its source TextBlockIR. */
interface UnitIR extends ReconUnit { block: TextBlockIR; }

/** Runs → LINES → PARAGRAPHS via the T1 text-reconstruction engine (src/engine/textRecon.ts —
 * a pdfplumber WordExtractor port). Table safety is preserved: a line sharing its y-band with
 * another x-disjoint line is a table ROW and never paragraph-merges, and column gutters split
 * a physical line into separate fragments — so spec/equipment grids keep one block per cell.
 * Rotated runs (vertical sidebars) keep their own boxes. */
export function clusterTextBlocks(allBlocks: TextBlockIR[]): TextBlockIR[] {
  const rotated = allBlocks.filter((b) => b.rotation !== 0);
  const blocks = allBlocks.filter((b) => b.rotation === 0);
  if (blocks.length < 2) return allBlocks;

  const units: UnitIR[] = blocks.map((b) => ({
    text: b.text, x0: b.x, x1: b.x + b.width, top: b.y, bottom: b.y + b.height,
    size: b.fontSize || 10, fontName: b.fontFamily, block: b,
  }));

  // ratio tolerances: our pages mix 86pt headings with 8pt table bodies, so absolute 3pt is
  // wrong at both ends (pdfplumber's *_tolerance_ratio option exists for exactly this).
  const reconBlocks = reconstruct(units, {
    yToleranceRatio: 0.4,       // same-baseline band (was |Δy| ≤ 0.4×size)
    xToleranceRatio: 0.08,      // ≤0.08em = a kerning/TJ split → join tight; any real word gap → space
    columnGapRatio: 2.0,        // a gutter splits a physical line into column fragments
    paragraphGapRatio: 1.45,    // top→top leading for paragraph merge
    minXOverlap: 0.5,
    maxSizeRatio: 1.15,
    rowSiblingGuard: true,
  });

  const out: TextBlockIR[] = [];
  for (const rb of reconBlocks) {
    const members = rb.lines.flatMap((l) => l.units.map((u) => u.block));
    if (members.length === 1 && rb.lines.length === 1) {
      // untouched single run — keep the original block, repairing reversed bracket pairs (F2)
      const only = members[0];
      const repaired = repairReversedBrackets(only.text);
      // F2: a dial-star number ("*4989") reads LEFT→RIGHT in the source (the star stays on the
      // LEFT, like a shortcode); pdf.js already flags the digits run 'ltr', which renders it
      // star-left — so keep that direction (an earlier 'rtl' override wrongly flipped it to
      // "4989*", contradicting the source's own visual order).
      out.push(repaired === only.text ? only : { ...only, text: repaired, originalText: repaired });
      continue;
    }
    const longest = members.reduce((m, b) => (b.text.length > m.text.length ? b : m), members[0]);
    const rtl = rb.rtl;
    out.push({
      ...longest,
      x: rb.x0, y: rb.top, width: rb.x1 - rb.x0, height: rb.bottom - rb.top,
      originalBBox: { x: rb.x0, y: rb.top, width: rb.x1 - rb.x0, height: rb.bottom - rb.top },
      text: repairReversedBrackets(rb.text), originalText: repairReversedBrackets(rb.text),
      fontSize: rb.size,
      lineHeight: rb.lineHeightRatio ?? longest.lineHeight ?? 1.2,
      direction: rtl ? 'rtl' : 'ltr',
      align: rtl ? 'end' : 'start',
    });
  }
  return [...out, ...rotated].sort((a, b) => a.y - b.y || a.x - b.x);
}

function round(n: number): number { return Math.round(n); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function cleanFontName(n?: string): string {
  if (!n) return 'sans-serif';
  // strip pdf.js subset prefixes like "g_d0_f1" / "ABCDEF+Name"
  return n.replace(/^[A-Z]{6}\+/, '').replace(/^g_d\d+_f\d+$/, 'sans-serif');
}
