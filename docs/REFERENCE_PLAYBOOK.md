# AutoSpec Studio — Reference Implementation Playbook

> **For Claude Code.** Companion to `docs/REBUILD_BRIEF.md`. That document defines
> the architecture and stages; this one gives you the *exact algorithms*, with
> parameters and code, distilled from studying the source of five production
> open-source projects: **pdfplumber** (`pdfplumber/utils/text.py`,
> `pdfplumber/table.py`), **pdf.js** (`src/display/text_layer.js`,
> `src/display/editor/*`), **bidi-js** (`src/reordering.js`), **fontkit**
> (`src/layout/*`, `src/glyph/Path.js`) and **camelot**
> (`camelot/image_processing.py`).
>
> Execution protocol: same as the brief. Run tasks T1→T6 continuously, no pauses
> between tasks; pause only before a material change as defined in the brief's
> Autonomy protocol. Verify each task's acceptance tests against real brand
> fixture PDFs before moving on.
>
> Optional: clone the references for consultation while implementing (keep out
> of the app bundle, add `refs/` to `.gitignore`):
> ```bash
> mkdir -p refs && cd refs
> git clone --depth 1 https://github.com/jsvine/pdfplumber
> git clone --depth 1 https://github.com/lojjic/bidi-js
> git clone --depth 1 https://github.com/foliojs/fontkit
> curl -sO https://raw.githubusercontent.com/mozilla/pdf.js/master/src/display/text_layer.js
> ```

---

## T1 — Text reconstruction engine (fixes fragmentation) → Brief Stages 1–2

**Source studied:** pdfplumber `WordExtractor` (utils/text.py). Its pipeline and
exact break conditions are the industry-proven fix for fragmented extraction.
Port it to TypeScript as `src/engine/textRecon.ts`, operating on pdf.js
`getTextContent()` items.

**Pipeline (in this order):**

1. **Normalize items.** Map every pdf.js text item to a unit:
   `{ text, x0, x1, top, bottom, size, fontName, dir }`. Compute from
   `item.transform`: `x0 = tx[4]`, baseline `y = tx[5]`, `size = hypot(tx[2],tx[3])`,
   `x1 = x0 + item.width`, `top = y - ascent*size`, `bottom = top + item.height`.
   pdf.js returns *runs*, not chars; the algorithm below works identically on runs.

2. **Group by style.** Group units by `(fontName, size, color)` only if you need
   style-pure spans; otherwise skip (pdfplumber groups by `upright` + optional
   extra attrs).

3. **Cluster into lines** (pdfplumber `cluster_objects`): sort units by `top`;
   walk sorted values, start a new line-cluster when
   `top > lastTop + Y_TOLERANCE`. **Y_TOLERANCE = 3** (points) is the proven
   default; expose a `yToleranceRatio` option = `ratio × unit.size` for mixed
   heading/body pages (pdfplumber's `y_tolerance_ratio`).

4. **Sort within each line by direction.** LTR: ascending `x0`. **RTL (Hebrew):
   descending `x1`** — pdfplumber implements RTL by negating coordinates
   (`ax=-prev.x1, bx=-prev.x0, cx=-curr.x1`), which yields logical order for
   Hebrew. Detect direction per line: if the majority of chars are in the Hebrew
   block (U+0590–U+05FF), the line is RTL.

5. **Merge units into words/segments.** Walk the sorted line; a unit **begins a
   new segment** when any of these three conditions holds (this is
   `char_begins_new_word`, verbatim logic):
   ```ts
   // direction-normalized coords: for RTL use negated x as above
   const newSegment =
        cx < ax                       // jumped backwards → new segment
     || cx > bx + X_TOLERANCE         // gap after prev end exceeds tolerance
     || Math.abs(cy - ay) > Y_TOLERANCE; // different baseline → different line
   ```
   **X_TOLERANCE = 3**, or dynamic `xToleranceRatio × prevUnit.size`
   (pdfplumber's `x_tolerance_ratio`; use ratio ≈ 0.3 when font sizes vary).
   Intraline distance is measured **end of prev → start of curr**; interline is
   **top → top** (bounding boxes of successive lines often overlap slightly —
   never compare bottoms).

6. **Lines → paragraphs (blocks).** Merge consecutive lines into one paragraph
   block when: vertical gap between baselines ≤ `1.35 × size`, horizontal spans
   overlap ≥ 50%, and same style group. A larger gap, an x-range shift, or a
   style change starts a new block. Column split: if a line's units contain an
   internal gap > `2.5 × size`, split into column segments before paragraphing.

7. **Output** `Block[]` per the brief's section-4 model, `text` in **logical
   order** (RTL sort in step 4 already produces logical order; do not reverse).

**Acceptance:** on a Peugeot/MG fixture page, a visually contiguous marketing
paragraph → exactly 1 text block; a mixed Hebrew+digits line reads logically
(`"מנוע 1.2 טורבו"` not reversed); raw item count vs block count reported (expect
≥10:1 reduction).

---

## T2 — Table detection → Brief Stage 2

**Source studied:** pdfplumber `table.py`. Two strategies; implement both in
`src/engine/tableDetect.ts`.

**Strategy A, "lines" (preferred for spec tables with rules):**
1. Collect vector edges: from pdf.js `getOperatorList()`, gather stroked/filled
   paths (`OPS.constructPath` + fill/stroke ops) and rectangles; classify as
   `h`/`v` edges. (Server-side alternative: PyMuPDF `page.get_drawings()`.)
2. **Snap** parallel edges whose positions differ ≤ **SNAP_TOLERANCE = 3**: cluster
   v-edges by `x0`, h-edges by `top` (the 1-D clusterer from T1 step 3), move each
   cluster to its average position.
3. **Join** collinear edges whose endpoints are within **JOIN_TOLERANCE = 3**
   into continuous lines.
4. **Intersections:** a v-edge and h-edge intersect when
   `v.top ≤ h.top+1 && v.bottom ≥ h.top-1 && v.x0 ≥ h.x0-1 && v.x0 ≤ h.x1+1`
   (tolerance **1**). Store per-vertex the touching edges.
5. **Cells:** for each intersection point (sorted), find the nearest point
   directly below and directly right that are *edge-connected* (share an actual
   edge object), and whose fourth corner exists and is edge-connected both ways;
   that rectangle is the smallest cell (pdfplumber `intersections_to_cells`).
6. **Cells → tables:** group contiguous cells (corner-sharing) into tables;
   derive `rows × cols` from sorted unique cell tops/lefts; assign each T1 word
   to the cell containing its center; join cell words with the T1 line logic.

**Strategy B, "text" (borderless tables), fallback when A finds no grid:**
- Vertical edges from alignment: cluster words by `x0`, by `x1`, and by center
  with tolerance **1**; keep clusters with ≥ **3** words (`min_words_vertical`);
  drop overlapping clusters; emit a v-edge at each surviving x plus one at the
  rightmost `x1`. Horizontal edges: cluster words by `top` (tolerance 1), keep
  clusters with ≥ **1** word, emit edges at each row's top *and* bottom spanning
  the table's x-range. Then run steps 4–6 above unchanged.

**Raster fallback (only for scanned pages, optional):** camelot lattice — 
`cv2.adaptiveThreshold`, then erode+dilate with structuring elements sized
`imageHeight // line_scale` (1×N) for vertical and `imageWidth // line_scale`
(N×1) for horizontal, **line_scale = 40**; joints = AND of the two line masks.
Do not build this now; note it as a Stage-later hook.

**Acceptance:** the 4-column technical table in a fixture extracts with exact
row/col counts and correct RTL cell text; a borderless equipment list extracts
via Strategy B with ≥90% cell accuracy.

---

## T3 — Editor overlay math (kills drift at every zoom) → Brief Stages 4–5

**Source studied:** pdf.js `text_layer.js` `#appendText`/`#layout` and
`editor/editor.js`. Three rules to adopt verbatim in the editor renderer:

1. **Position in page-relative percentages, not pixels.**
   ```ts
   const tx = mat.multiply(viewport.transform, item.transform); // 6-tuple compose
   const angle = Math.atan2(tx[1], tx[0]);
   const fontHeight = Math.hypot(tx[2], tx[3]);
   const top  = tx[5] - fontAscent * fontHeight;   // baseline → box top
   const left = tx[4];                              // (+ascent*sin/cos if rotated)
   el.style.left = `${(100 * left / pageWidthPx).toFixed(2)}%`;
   el.style.top  = `${(100 * top  / pageHeightPx).toFixed(2)}%`;
   ```
   Because positions are % of the page container, **zoom changes never require
   repositioning** — the container scales, everything follows. pdf.js's editor
   stores every editor's `x,y` as *fractions of page dimensions* for the same
   reason (`this.x = x / pageWidth`). Store block screen positions the same way.

2. **Zoom-aware font size via CSS variable, not JS reflow.** Set
   `--scale-factor` on the page container (pdf.js contract:
   `container.style.setProperty('--scale-factor', viewport.scale)`), and size
   text as `font-size: calc(${sizePt}px * var(--scale-factor))` (pdf.js
   freetext editor does exactly this). Zoom = one CSS var update.

3. **Width correction for font-metric mismatch.** Screen fonts never match the
   embedded font's advances. pdf.js fix: measure the string with canvas
   `ctx.measureText` at `fontSize × scale`, then set
   `--scale-x = (pdfWidth × scale) / measuredWidth` and apply
   `transform: scaleX(var(--scale-x))`. Result: the DOM run occupies exactly the
   PDF-specified width. Apply this to the *reference underlay* text layer; for
   the block model's own editable text (already screen-native) it is not needed.

Plus the canvas rule: back the render canvas with `devicePixelRatio`-scaled
pixels while CSS-sizing it to the viewport (`canvas.width = vw*dpr`,
`canvas.style.width = vw+'px'`).

**Acceptance:** at 50/100/200% zoom on a HiDPI screen, a marker block and the
underlay stay pixel-aligned; toggling zoom does not run any JS repositioning of
blocks (verify: only the CSS vars change).

---

## T4 — Hebrew bidi pipeline for export → Brief Stage 8

**Source studied:** bidi-js `src/reordering.js` (implements UAX #9 rules L1–L2
exactly). Implement `src/engine/bidi.ts`:

```ts
import bidiFactory from 'bidi-js';
const bidi = bidiFactory();                       // once, module level

export function toVisualLine(logical: string): string {
  const levels = bidi.getEmbeddingLevels(logical, 'rtl'); // paragraph dir = rtl
  let visual = bidi.getReorderedString(logical, levels);  // applies L1+L2
  return visual;                                          // mirroring handled inside
}
```

Hard rules learned from the source:
- **Reorder per wrapped line, never per paragraph.** `getReorderSegments`
  takes `(start, end)` for exactly this: wrap first (in logical order, using
  measured widths), then reorder each line slice. Rule L1 resets trailing
  whitespace to paragraph level per line; reordering the whole paragraph then
  cutting lines produces wrong edges.
- **Never hand-reverse strings.** The L2 loop reverses nested level runs
  (highest level → lowest odd level); naive reversal is exactly the
  digits-reversed bug (`1234` → `4321`).
- Bracket mirroring: `getReorderedString` already maps mirrored characters
  (`(` ↔ `)`); if you use `getReorderedIndices` instead, apply
  `getMirroredCharactersMap` yourself.

**Export drawing** (pdf-lib): for each wrapped logical line →
`visual = toVisualLine(line)` → `w = font.widthOfTextAtSize(visual, size)` →
`page.drawText(visual, { x: boxRight - w, y, font, size })`. Right alignment is
always `boxRight − measuredWidth`; never left-anchor RTL text.

**Acceptance tests (fixtures in a unit test):**
`'מחיר: 149,900 ₪'`, `'מנוע 1.2 PureTech טורבו'`, `'(אוטומטי) 8 הילוכים'` — digits
ascending left-to-right inside the RTL flow, Latin run intact, brackets facing
correctly; exported PDF visually identical to the editor rendering.

---

## T5 — Glyph-outline export (fidelity upgrade, build only if T4 output is insufficient)

**Source studied:** fontkit `TTFFont.layout()` → `GlyphRun` with `glyphs[]` and
`positions[]` (`xAdvance, xOffset, yOffset` in font units), `glyph.path` with
`.scale()` and `.toSVG()`.

```ts
const run = font.layout(visualLine, undefined, 'hebr', undefined, 'rtl');
const s = sizePt / font.unitsPerEm;
let penX = 0;
for (let i = 0; i < run.glyphs.length; i++) {
  const g = run.glyphs[i], p = run.positions[i];
  const svg = g.path.scale(s, -s).toSVG();        // flip Y: font is y-up, drawSvgPath expects y-down
  page.drawSvgPath(svg, { x: originX + (penX + p.xOffset * s), y: baselineY - p.yOffset * s, color });
  penX += p.xAdvance * s;
}
```
This makes output independent of any viewer's font handling (perfect for print
masters) at the cost of selectable text; keep T4 as default, gate T5 behind an
`exportMode: 'text' | 'outlines'` option. Note `font.layout` applies GSUB/GPOS,
so niqqud marks position correctly.

---

## T6 — Auto-fit into fixed slots → Brief Stage 7

Combine T4 measurement with binary search (10 iterations max, then one final
overflow-guarantee pass):

```ts
function fitText(text: string, box: BBox, font: PDFFont, min=6, max=24): Fit {
  let lo = min, hi = max, best = min;
  for (let i = 0; i < 10; i++) {
    const size = (lo + hi) / 2;
    const lines = wrapLogical(text, box.w, font, size);   // measured widths
    const h = lines.length * size * 1.35;                  // lineHeight factor
    if (h <= box.h && lines.every(l => font.widthOfTextAtSize(toVisualLine(l), size) <= box.w))
      { best = size; lo = size; } else { hi = size; }
  }
  return { size: best, lines: wrapLogical(text, box.w, font, best) };
}
```
Wrap in logical order; convert to visual per line only at draw time (T4).

**Acceptance:** shortest and longest model names in the fixture data both fit
the same slot with no clipping; table cells shrink independently.

---

## Task → file map and order

| Task | New module | Depends on | Brief stage |
|---|---|---|---|
| T1 | `src/engine/textRecon.ts` (+ unit tests w/ fixture items) | — | 1–2 |
| T2 | `src/engine/tableDetect.ts` | T1 words | 2 |
| T3 | `src/editor/layerMath.ts` + editor CSS vars | — | 4–5 |
| T4 | `src/engine/bidi.ts` + export text path | — | 8 |
| T5 | `src/engine/glyphExport.ts` (optional, gated) | T4 | 8 |
| T6 | `src/engine/autofit.ts` | T4 | 7 |

Dependencies to add: `bidi-js` (tiny, zero-dep). `fontkit` is already present
via `@pdf-lib/fontkit`; T5 may need full `fontkit` for `layout()` — check
whether the pdf-lib fork exposes it before adding.

Run T1 and T3 first (highest user-visible impact), then T4, T2, T6, T5.
