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
    // real glyph boxes are ~1.3× the nominal size (ascender+descender); a box of exactly
    // `size` visually clips descenders in the editor (measured vs PyMuPDF: true ≈ 1.38×).
    const boxH = (it.height || size) * 1.3;

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
      rotation: 0,
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

const HEB = /[֐-׿]/;
function isRtlText(s: string): boolean {
  let he = 0, lat = 0;
  for (const ch of s) { if (HEB.test(ch)) he++; else if (/[A-Za-z]/.test(ch)) lat++; }
  return he >= lat && he > 0;
}

/** Merge same-baseline adjacent runs into LINES, then stacked prose lines into PARAGRAPHS.
 * Table safety: a line that shares its y-band with another line (a table ROW with several
 * cells) is never paragraph-merged, and big horizontal gaps (column gutters) never line-merge —
 * so spec/equipment grids keep one block per cell. */
export function clusterTextBlocks(blocks: TextBlockIR[]): TextBlockIR[] {
  if (blocks.length < 2) return blocks;

  // ---- phase 1: lines (union-find over same-baseline neighbours) ----
  const par = blocks.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      const fa = a.fontSize || 10, fb = b.fontSize || 10;
      if (Math.max(fa, fb) / Math.min(fa, fb) > 1.3) continue;
      if (Math.abs(a.y - b.y) > Math.min(fa, fb) * 0.4) continue;
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
      if (gap > Math.max(fa, fb) * 0.9 || gap < -Math.max(fa, fb)) continue; // gutters & deep overlaps stay apart
      par[find(i)] = find(j);
    }
  }
  const groups = new Map<number, TextBlockIR[]>();
  blocks.forEach((b, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(b); });

  const mergeGroup = (grp: TextBlockIR[], joiner: string): TextBlockIR => {
    // CONTENT order = original array order (logical); never sort by x
    const longest = grp.reduce((m, b) => (b.text.length > m.text.length ? b : m), grp[0]);
    const x0 = Math.min(...grp.map((b) => b.x)), y0 = Math.min(...grp.map((b) => b.y));
    const x1 = Math.max(...grp.map((b) => b.x + b.width)), y1 = Math.max(...grp.map((b) => b.y + b.height));
    const text = grp.map((b) => b.text.trim()).filter(Boolean).join(joiner);
    const rtl = isRtlText(text);
    return {
      ...longest,
      x: x0, y: y0, width: x1 - x0, height: y1 - y0,
      originalBBox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      text, originalText: text,
      fontSize: Math.max(...grp.map((b) => b.fontSize)),
      direction: rtl ? 'rtl' : 'ltr',
      align: rtl ? 'end' : 'start',
    };
  };

  const lines: TextBlockIR[] = [];
  for (const grp of groups.values()) lines.push(grp.length === 1 ? grp[0] : mergeGroup(grp, ' '));
  lines.sort((a, b) => a.y - b.y || a.x - b.x);

  // ---- phase 2: paragraphs (stacked prose lines; table rows excluded) ----
  const isProse = (b: TextBlockIR) => b.text.trim().split(/\s+/).length >= 2 || b.text.trim().length >= 14;
  const hasRowSibling = (i: number) => lines.some((o, j) => j !== i
    && Math.abs(o.y - lines[i].y) < Math.min(o.fontSize, lines[i].fontSize) * 0.5
    && (Math.max(o.x, lines[i].x) - Math.min(o.x + o.width, lines[i].x + lines[i].width)) > 0);
  const par2 = lines.map((_, i) => i);
  const find2 = (i: number): number => (par2[i] === i ? i : (par2[i] = find2(par2[i])));
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    if (!isProse(a) || hasRowSibling(i)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (!isProse(b) || hasRowSibling(j)) continue;
      const fa = a.fontSize, fb = b.fontSize;
      if (Math.max(fa, fb) / Math.min(fa, fb) > 1.15) continue;
      const vgap = b.y - (a.y + a.height);
      if (vgap < -2 || vgap > Math.min(fa, fb) * 0.55) continue; // real paragraph leading only
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      if (xOverlap < Math.min(a.width, b.width) * 0.5) continue;
      par2[find2(i)] = find2(j);
    }
  }
  const groups2 = new Map<number, TextBlockIR[]>();
  lines.forEach((b, i) => { const r = find2(i); (groups2.get(r) || groups2.set(r, []).get(r)!).push(b); });
  const out: TextBlockIR[] = [];
  for (const grp of groups2.values()) {
    if (grp.length === 1) { out.push(grp[0]); continue; }
    grp.sort((a, b) => a.y - b.y);
    const m = mergeGroup(grp, '\n');
    // real leading from the source: distance between consecutive line tops / font size
    const lead = (grp[1].y - grp[0].y) / Math.max(1, m.fontSize);
    m.lineHeight = Math.min(1.8, Math.max(1.05, Math.round(lead * 100) / 100));
    out.push(m);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function round(n: number): number { return Math.round(n); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function cleanFontName(n?: string): string {
  if (!n) return 'sans-serif';
  // strip pdf.js subset prefixes like "g_d0_f1" / "ABCDEF+Name"
  return n.replace(/^[A-Z]{6}\+/, '').replace(/^g_d\d+_f\d+$/, 'sans-serif');
}
