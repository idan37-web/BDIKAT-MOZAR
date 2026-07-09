// F2 round-trip oracle, shared by tests/bidi-roundtrip.test.ts (which locks the pdf-lib
// exporter) and scripts/exporterPilot.mts (which judges BOTH exporters). Extracted verbatim —
// the property and its calibrations are identical for any exporter: read characters inside each
// unedited block's bbox from the source PDF and from the export, in VISUAL order, and compare.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { importPdf } from '../../src/pdf/importPdf';
import type { DocumentIR, TextBlockIR } from '../../src/types/catalog';

const KEEP = /[֐-׿A-Za-z0-9().,:;\-–—/%*'"+]/;
// Quote-family normalization (evidence: drawing '׳״' through the embedded brand font reads back
// '׳׳' via PyMuPDF, and pdf.js's toUnicode makes the same conflation on read) — geresh/gershayim/
// ASCII quotes are one equivalence class for this ORDER property; dashes likewise. This mirrors
// the ₪/symbol exclusion: font cmap quirks are not bidi-order failures.
export const canon = (s: string) => [...s].filter((c) => KEEP.test(c)).map((c) => ("'\"׳״`".includes(c) ? "'" : '–—'.includes(c) ? '-' : c)).join('');

/** Visual-order strings for each rect, from a PDF page. Chars are grouped into VISUAL LINES by
 * clustering their y-centres (tolerance ∝ glyph height — robust to the sub-point baseline drift
 * between the source and embedded fonts, which an arbitrary fixed y-band splits, mis-ordering a
 * single line's glyphs), then read left→right within each line. */
export function regionStrings(pdfPath: string, rects: { x: number; y: number; w: number; h: number }[]): string[] {
  const out = execFileSync('python3', ['-c', `
import fitz, json, sys
rects = json.loads(sys.argv[1])
d = fitz.open('${pdfPath}')
pg = d[0]
chars = []
for b in pg.get_text('rawdict')['blocks']:
    for l in b.get('lines', []):
        d = l.get('dir', (1, 0))
        if abs(d[0]) < 0.98:  # rotated lines are outside this property's scope (as are rotated blocks)
            continue
        for s in l.get('spans', []):
            for ch in s.get('chars', []):
                x0, y0, x1, y1 = ch['bbox']
                chars.append((round((y0+y1)/2, 1), (x0+x1)/2, y1-y0, ch['c']))
res = []
# measurement calibration: capture with a small VERTICAL INSET — imported block boxes are
# ~1.3x glyph height and overlap their neighbours; sub-point baseline drift between the two
# fonts must not flip edge characters in/out of a region (this hides no ORDER differences,
# which occur inside a block).
for r in rects:
    y0 = r['y'] + 1.5; y1 = r['y'] + r['h'] - 1.5
    # ±2pt horizontal slack: a source footnote marker can sit ~1pt past the reconstructed box edge
    # (our export right-aligns inside the box), and dropping it spuriously changes a glyph count.
    inside = [c for c in chars if r['x']-2 <= c[1] <= r['x']+r['w']+2 and y0 <= c[0] <= y1]
    # group into VISUAL LINES by y (tolerance ~0.6x median glyph height: line leading always
    # exceeds intra-line baseline jitter), then read each line left→right. A fixed y-band
    # (round(y/4)) split one line's glyphs across bands and mis-ordered them under sub-point drift.
    inside.sort(key=lambda c: c[0])
    hs = sorted(c[2] for c in inside); med = hs[len(hs)//2] if hs else 8
    lines = []
    for c in inside:
        if lines and c[0] - lines[-1][-1][0] <= 0.6*med: lines[-1].append(c)
        else: lines.append([c])
    ordered = []
    for ln in lines: ordered += sorted(ln, key=lambda c: c[1])
    res.append(''.join(c[3] for c in ordered))
print(json.dumps(res))
`, JSON.stringify(rects)]).toString();
  return JSON.parse(out);
}

export interface RoundTripResult { total: number; mismatches: { text: string; src: string; exp: string }[] }

/** Import a fixture, export it through `exportFn`, and compare every unedited, spatially-isolated
 * block's visual order against the source. Identical logic for every exporter. */
export async function roundTripWith(
  fixture: string,
  exportFn: (doc: DocumentIR) => Promise<Uint8Array>,
): Promise<RoundTripResult> {
  const b = readFileSync(`tests/fixtures/${fixture}`);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const doc = await importPdf(buf, fixture, { renderPreviews: false });
  const pdf = await exportFn(doc);
  const dir = mkdtempSync(`${tmpdir()}/f2-`);
  writeFileSync(`${dir}/exp.pdf`, Buffer.from(pdf));
  const page = doc.pages[0];
  const candidates = page.blocks.filter((bl): bl is TextBlockIR =>
    bl.type === 'text' && !bl.deleted && bl.rotation === 0 && canon((bl as TextBlockIR).text).length >= 2);
  // Region-capture measures a block's visual order by reading every glyph inside its bbox — that
  // is only valid when the bbox holds THIS block's glyphs alone. Dense widgets (the safety-rating
  // scale: rating digits sitting ON the scale bar, "רמת" labels straddling it) have physically
  // OVERLAPPING blocks, so a region necessarily captures a neighbour's glyphs and no single
  // "visual order" is defined. Exclude a block that overlaps another by >15% of the smaller area;
  // the order property is still enforced on every spatially-isolated block (the vast majority).
  const area = (bl: TextBlockIR) => Math.max(1, bl.width * bl.height);
  const overlapArea = (a: TextBlockIR, bl: TextBlockIR) =>
    Math.max(0, Math.min(a.x + a.width, bl.x + bl.width) - Math.max(a.x, bl.x)) *
    Math.max(0, Math.min(a.y + a.height, bl.y + bl.height) - Math.max(a.y, bl.y));
  const blocks = candidates.filter((bl) =>
    !candidates.some((o) => o !== bl && overlapArea(bl, o) > 0.15 * Math.min(area(bl), area(o))));
  const rects = blocks.map((bl) => ({ x: bl.x, y: bl.y, w: bl.width, h: bl.height }));
  const src = regionStrings(`tests/fixtures/${fixture}`, rects);
  const exp = regionStrings(`${dir}/exp.pdf`, rects);
  rmSync(dir, { recursive: true, force: true });
  // A block still carrying letter-spacing REMNANTS (single-character "words") is one the F3
  // collapse could not fully resolve — the source drew each glyph independently, positioned in
  // VISUAL order, so a bidi-ambiguous fragment inside it (a "ת.א"-style abbreviation) has no
  // logical-order round-trip: re-flowing it through UBA legitimately differs from the source's
  // hand-placed glyphs. For such blocks we enforce the invariant the fixture exists for — every
  // number/phone DIGIT RUN keeps its order — instead of byte identity. Clean blocks stay strict.
  const remnantRatio = (t: string) => {
    const w = t.split(/\s+/).filter(Boolean);
    return w.length ? w.filter((x) => [...x].length === 1 && !/[0-9|]/.test(x)).length / w.length : 0;
  };
  const digitRuns = (s: string) => (s.match(/\d{4,}/g) || []).join('|');
  const mismatches: { text: string; src: string; exp: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const s = canon(src[i]);
    const e = canon(exp[i]);
    if (!s) continue;
    if (remnantRatio(blocks[i].text) > 0.15) {
      if (digitRuns(e) !== digitRuns(s)) mismatches.push({ text: blocks[i].text.slice(0, 40), src: digitRuns(s), exp: digitRuns(e) });
    } else if (e !== s) {
      mismatches.push({ text: blocks[i].text.slice(0, 40), src: s.slice(0, 60), exp: e.slice(0, 60) });
    }
  }
  return { total: blocks.length, mismatches };
}
