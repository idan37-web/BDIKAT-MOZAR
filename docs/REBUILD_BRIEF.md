# AutoSpec Studio — Architecture Rebuild Brief

> **For an autonomous coding agent (Claude Code / Codex).** This is a staged
> engineering plan to turn AutoSpec Studio into a professional-grade Hebrew PDF
> spec-catalog editor and template-learning tool. Read this whole document
> before writing any code.

---

## 0. How to use this document

- **Work against the source repository, not any bundled/minified HTML build.**
  The single-file `*.html` bundle is compiled output and must never be edited.
  If you cannot find the TypeScript/React source, stop and ask for the repo.
- This is a **staged plan (Stage 0 → Stage 9)** with explicit acceptance
  criteria per stage. Implement the stages **in order**.
- **Run continuously, start to finish.** Do the stages back to back without
  pausing between them. After each stage, self-verify its acceptance criteria
  against a real fixture PDF, write a 3-line note of what changed and what you
  checked, then start the next stage on your own. Do not wait for approval to
  keep going.
- **Pause only before a material change** you are about to make (see section 7
  for the exact triggers). For everything else, decide the reasonable default,
  implement, verify, and proceed.
- **Do not do a big-bang rewrite.** Refactor incrementally behind the block
  model. Keep the app runnable at the end of every stage.
- TypeScript **strict mode** on. No `any` in new code. Every new module gets at
  least one unit test with a real fixture PDF.

---

## 1. Context — what the app is

AutoSpec Studio is a Hebrew (RTL) PWA for the Israeli automotive market. Stack:
**Vite + TypeScript + React**, `pdfjs-dist` for parsing/rendering, `pdf-lib`
+ `@pdf-lib/fontkit` for export, IndexedDB/localStorage for persistence.

It has **two jobs**:

1. **Learn a brand template** from existing spec-sheet PDFs (MG, Peugeot,
   Citroën, Opel, IM Motors): detect page types, text regions, image regions,
   table structure, colors, fonts, logo positions, and mark each region as
   **fixed (קבוע)** or **variable (משתנה/דינמי)**.
2. **Author a new spec sheet**: place raw materials (images, marketing copy,
   technical tables, colors, wheels, safety data, emissions data) into the
   learned template, let the user edit visually (move/resize, edit text,
   replace images, edit tables, reorder pages), then **export a print-ready
   PDF** with correct Hebrew RTL, typography, and images.

**Current symptoms to fix:** (a) inconsistent template learning, (b) text
fragmentation in parsing (text broken into many tiny pieces instead of coherent
lines/paragraphs), (c) broken/low-fidelity visual rendering in the editor,
(d) extracted images have neighboring text/elements "burned in", (e) Hebrew
in the exported PDF is unreliable.

---

## 2. Root diagnosis — why it is not professional-grade yet

| # | Symptom | Root cause | Correct technique |
|---|---------|-----------|-------------------|
| 1 | Text fragmentation | `pdf.js` `getTextContent()` returns items split at every kerning/`TJ`-array/font boundary. There is **no** notion of words, lines, paragraphs, columns, or reading order — a PDF content stream is *drawing instructions*, not a document model. | Reconstruct structure by clustering: group items into lines by baseline Y (tolerance from font size), then into words/columns by X-gap thresholds. Better: extract server-side with **PyMuPDF** `page.get_text("dict")`, which already returns blocks → lines → spans with bbox/font/size/color. |
| 2 | Burned-in images | The app rasterizes a **region of the rendered page** (crops the canvas). A crop captures whatever overlaps that rectangle — text, other images. | Extract the **actual embedded image XObject**, never a canvas crop. `pdf.js`: walk `getOperatorList()` for `OPS.paintImageXObject`/`paintJpegXObject`, pull the object from `page.objs`/`page.commonObjs`, use its transform matrix for placement. PyMuPDF: `page.get_images()` + `doc.extract_image()`. |
| 3 | Broken editor rendering | Coordinate-system mismatch: PDF is points, bottom-left origin, Y-up; DOM is px, top-left origin, Y-down; `pdf.js` viewport applies a scale + `devicePixelRatio` transform. Absolutely-positioned textarea overlays drift across zoom/DPR, and screen-font metrics don't match the embedded PDF font, so overlaid text never matches the render underneath. | Stop overlaying editable text on top of a render of the *same* text. Make the **block model the source of truth** and render the *block model* into the editable view. Use the original PDF render only as a template-learning input / faint reference, not as the live editing backdrop. Where any overlay is needed, map coordinates through the exact viewport transform (`viewport.convertToViewportPoint`) and account for DPR. |
| 4 | Inconsistent template learning | Structure is inferred from a single doc and from unreliable fragmented extraction, with no registration step and no principled fixed-vs-variable rule. | Require reliable extraction (row 1), run layout analysis for region detection (whitespace / XY-cut, or an ML layout model such as **LayoutParser**/Detectron2), and derive fixed-vs-variable by **registering multiple samples of the same brand and diffing**: invariant position+content → fixed; varying → variable slot. This is the Azure Document Intelligence / Google Document AI "fixed anchors + variable fields" pattern. |
| 5 | Unreliable Hebrew export | `pdf-lib` does **not** do bidi reordering or text shaping, and `StandardFonts` have no Hebrew. Passing a logical-order Hebrew string to `drawText` produces wrong output; naive character reversal breaks numbers and Latin runs. | Embed a Unicode Hebrew font via `fontkit`; run every line through the **Unicode Bidirectional Algorithm (UAX #9)** with **bidi-js** to get visual order (handles mixed Hebrew/Latin/digits); measure with `font.widthOfTextAtSize` and place from the right margin; wrap in logical order first, then apply bidi per line. For pixel-perfect fidelity, optionally draw text as vector glyph outlines via `fontkit`/`opentype.js`. |

---

## 3. Target architecture — the spine

**One rule above all: a serializable JSON block model is the single source of
truth.** It is produced by extraction + template-learning, edited by the user,
and rendered to *both* the on-screen editor and the exported PDF. The editor and
the exporter are two renderers of the same model — never two separate states.

Keep three concerns strictly separated (this is how PSPDFKit/Nutrient,
Apryse/PDFTron, Foxit are built):

1. **Fidelity display** — a faithful raster of the source PDF page (`pdf.js`
   canvas). Read-only. Used for template learning and as a reference underlay.
2. **Editable model** — the block model. What the user manipulates.
3. **Export** — deterministic render of the block model to PDF.

**Pipeline:** `parse → reconstruct structure → learn template (fixed/variable) →
bind new content into slots → edit via block model → export high-fidelity Hebrew
PDF`.

**Client-only is not sufficient for the extraction/learning half.** Adopt a
**hybrid**: a Python extraction service (PyMuPDF + pdfplumber + Camelot) does
robust parsing, structure reconstruction, image-XObject extraction, and template
learning, returning the block model as JSON + asset blobs. The React app is the
authoring/editing client. If a backend is genuinely off the table, the fallback
is PyMuPDF/pdfplumber compiled to WASM, or a disciplined `pdf.js` `operatorList`
+ reconstruction implementation — but treat that as a downgrade and isolate it
behind the same interface. Export can remain `pdf-lib` as long as the block
model is clean; revisit only if fidelity is insufficient.

---

## 4. The data model (define this first, in Stage 0)

Treat this as the contract. **Changing these types counts as a material change**,
so flag it and confirm before proceeding (see section 7). Illustrative shape
(adjust names, keep the semantics):

```ts
type Brand = 'mg' | 'peugeot' | 'citroen' | 'opel' | 'im' | 'unknown';
type Unit = { w: number; h: number };            // PDF points
type BBox = { x: number; y: number; w: number; h: number }; // top-left origin, points

type Style = {
  fontFamily: string; fontSize: number; color: string;
  align: 'right' | 'center' | 'left';             // default 'right' (RTL)
  lineHeight?: number; bold?: boolean; letterSpacing?: number;
};

type BlockRole = 'fixed' | 'variable';            // template semantics
type BlockKind =
  | 'text' | 'heading' | 'legal'
  | 'image' | 'logo'
  | 'table'
  | 'colorSwatch' | 'wheel'
  | 'safetyList' | 'emissions';

type Block = {
  id: string;
  kind: BlockKind;
  bbox: BBox;
  role: BlockRole;
  slotId?: string;             // links a variable block to a template slot
  z: number;
  style?: Style;
  // content by kind:
  text?: string;               // logical order, NOT pre-reversed
  assetId?: string;            // -> AssetStore (image/logo)
  table?: { rows: string[][]; colWidths?: number[]; style?: Style };
};

type Page = { size: Unit; blocks: Block[] };
type SpecDoc = { id: string; brand: Brand; templateId?: string; pages: Page[] };

// Template = a SpecDoc skeleton where variable blocks are empty slots
type Slot = { slotId: string; kind: BlockKind; bbox: BBox; style: Style; label: string };
type Template = {
  id: string; brand: Brand;
  pages: { size: Unit; fixedBlocks: Block[]; slots: Slot[] }[];
  palette: string[]; fonts: string[]; logoSlotIds: string[];
};
```

- **Coordinate convention for the whole app: top-left origin, Y-down, PDF
  points.** Convert to `pdf.js` viewport space only at render time, and flip to
  `pdf-lib`'s bottom-left origin only at export time. Centralize both conversions
  in one `coords.ts` module; nothing else does coordinate math.
- `text` is always stored in **logical order**. Bidi/visual reordering happens
  only inside renderers (editor + export), never in the model.

---

## 5. Ground rules / guardrails

- Runnable app after every stage; no stage leaves `main` broken.
- New code: TS strict, no `any`, one real-fixture test per module.
- All coordinate math goes through `coords.ts`. All bidi/shaping goes through one
  `bidi.ts`. No ad-hoc reversing or offset math scattered in components.
- Keep 2–3 real sample PDFs per brand as fixtures in the repo for tests.
- Don't add a heavyweight dependency without noting it in the stage summary.
- Introducing a backend where none exists is a material change (section 7):
  propose the smallest viable option, a single Python FastAPI endpoint, and
  confirm before building it.

---

## 6. Staged tasks

Each stage: **Goal → Approach → Acceptance criteria (verify these before
starting the next stage).**

### Stage 0 — Lock the data model + coordinate/bidi seams
- **Goal:** the contract from section 4 exists and everything routes through it.
- **Approach:** add `types.ts` (the model), `coords.ts` (PDF↔viewport↔pdf-lib
  conversions, both directions, unit-tested), `bidi.ts` (thin wrapper around
  `bidi-js`). No feature work yet.
- **Accept:** `coords.ts` round-trips a point PDF→viewport→PDF within <0.5pt in a
  test; `bidi.ts` reorders a mixed string like `מחיר: 149,900 ₪ (GT)` and a test
  asserts digits and the Latin run are **not** reversed.

### Stage 1 — Reliable extraction into the block model
- **Goal:** a PDF becomes a `SpecDoc` with correctly-grouped blocks.
- **Approach:** implement extraction that returns the block model. **Preferred:**
  Python service using **PyMuPDF** `page.get_text("dict")` for text
  blocks/lines/spans (bbox, font, size, color) → map to `text`/`heading` blocks.
  Fallback: `pdf.js` `getTextContent()` + Stage 2 reconstruction.
- **Accept:** on a real brand PDF, a full marketing paragraph comes back as **one
  `text` block** (or a small number of line blocks), **not** dozens of glyph
  fragments. Report block count vs raw item count in the summary.

### Stage 2 — Text-structure reconstruction (only if not using PyMuPDF dict)
- **Goal:** coherent lines/words/paragraphs/columns from raw positioned items.
- **Approach:** cluster items into lines by baseline Y with tolerance ≈ `0.3 ×
  fontSize`; within a line sort by X and merge runs; word-break when gap > ≈`0.3 ×
  space-advance`, column-break at large gaps. Mirror pdfplumber's
  `x_tolerance`/`y_tolerance` heuristics. Determine reading order; handle RTL by
  operating in logical order and letting `bidi.ts` handle visual order at render.
  Tables: detect by drawn ruling lines (Camelot "lattice" idea) first, else by
  aligned-whitespace columns (Camelot "stream" / pdfplumber table settings).
- **Accept:** for a fixture spec page, reconstructed lines match the visual lines
  (±1), and a known 4-column spec table extracts as a `table` block with correct
  row/column counts.

### Stage 3 — Image / logo extraction (fix burned-in)
- **Goal:** extracted images contain only their own pixels.
- **Approach:** extract embedded XObjects, never canvas crops. PyMuPDF
  `page.get_images()` + `doc.extract_image()`; or `pdf.js` `getOperatorList()`
  → `paintImageXObject`/`paintJpegXObject` → `page.objs.get(name)`, placement
  from the op's transform matrix. Store bytes in the AssetStore; block references
  by `assetId`.
- **Accept:** an image that visually sits next to Hebrew copy is extracted with
  **no** burned-in text (verify by eye on 3 fixtures) and placed at the correct
  bbox.

### Stage 4 — Editor renders the block model (the architectural pivot)
- **Goal:** the editable view is a renderer of the block model, not overlays on a
  PDF raster.
- **Approach:** render each `Block` as a positioned React element from
  model→viewport coords via `coords.ts`. Text blocks render editable content
  whose value is the model's logical-order `text`; the source PDF raster becomes
  an optional faint underlay for template work only. Move/resize/edit/reorder all
  mutate the model.
- **Accept:** editing text, moving a block, and reordering pages all update the
  model and re-render with no drift; toggling the PDF underlay on/off does not
  move any block.

### Stage 5 — Coordinate & DPR correctness for any raster/overlay
- **Goal:** rasters and any residual overlays align perfectly across zoom/DPR.
- **Approach:** render `pdf.js` to canvas at `devicePixelRatio`-aware scale;
  size the CSS box by viewport CSS size, back the canvas by `dpr`-scaled pixels;
  map every overlay through the same `viewport` transform.
- **Accept:** at 50%, 100%, 200% zoom and on a HiDPI display, the underlay and a
  test marker block stay pixel-aligned to a reference feature in the PDF.

### Stage 6 — Template learning (fixed vs variable)
- **Goal:** from 2–3 same-brand samples, produce a `Template` with fixed blocks
  and variable slots.
- **Approach:** extract each sample (Stages 1–3). **Register/align** pages
  (normalize page size; align by shared anchors such as logo/frame). Diff blocks
  across samples: same kind+bbox+content across all → `fixed`; same kind+bbox but
  content varies → `variable` **slot**. Capture palette, fonts, logo slots. Keep
  a manual review UI so the user can flip fixed↔variable and label slots
  (matching the spec's Stage ב confirmation step). Region detection where needed:
  whitespace/XY-cut, or LayoutParser/Detectron2 for block typing.
- **Accept:** on 3 samples of one brand, logo/frame/legal come out `fixed`, and
  model-name/main-image/spec-values come out `variable` slots, with the review UI
  able to correct any misclassification and persist it.

### Stage 7 — Content binding + auto-fit into slots
- **Goal:** new raw materials fill a template's slots and fit their boxes.
- **Approach:** map uploaded materials to slots by kind/label; write into the
  model. **Auto-fit** variable text: binary-search the largest `fontSize` where
  the `bidi`-processed, width-measured (`font.widthOfTextAtSize`), wrapped text
  fits the slot's bbox height; cache measurements. Images fit by contain/cover
  within the slot bbox.
- **Accept:** a long and a short model name both render inside the same slot
  without overflow or clipping; a bound spec table respects column widths.

### Stage 8 — High-fidelity Hebrew PDF export
- **Goal:** exported PDF matches the editor and has correct Hebrew.
- **Approach:** one exporter renders the model to `pdf-lib`. Register `fontkit`,
  embed the Unicode Hebrew font. For every text run: wrap in logical order →
  `bidi.ts` per line → `drawText` positioned from the right margin via measured
  widths, flipping to bottom-left origin in `coords.ts`. Draw images from
  AssetStore XObjects; draw tables cell-by-cell with the same text pipeline. If
  fidelity gaps remain, switch text to vector glyph outlines via
  `fontkit`/`opentype.js`.
- **Accept:** exported PDF of a bound template is visually equal to the editor;
  a line mixing Hebrew + digits + a Latin token (e.g. `149,900 ₪ GT`) renders in
  correct visual order; right-alignment is exact; selectable text where possible.

### Stage 9 — Persistence (IndexedDB) + PWA
- **Goal:** templates, projects, fonts, and assets persist client-side.
- **Approach:** IndexedDB for binary blobs (source PDFs, fonts, extracted
  images) and for `SpecDoc`/`Template` JSON; assets keyed by content hash and
  deduped. Drop `localStorage` for anything but tiny flags. Confirm the service
  worker caches the app shell and fonts for offline use.
- **Accept:** reload restores the exact project and template; assets aren't
  duplicated across projects; the app opens offline.

---

## 7. Autonomy protocol (keep visible)

- **Default is continuous execution.** Run Stage 0 → Stage 9 end to end. Do not
  pause between stages, and do not ask permission for routine implementation
  choices. After each stage, verify its acceptance criteria and log a short
  summary, then begin the next stage yourself.
- **Pause and ask only before a material change** you are about to make, meaning
  one that is expensive or hard to reverse:
  - (a) changing the section-4 data model contract (`Block` / `Template` /
    `SpecDoc`);
  - (b) introducing a backend service where none currently exists;
  - (c) adding a heavy dependency or swapping a core library (e.g. moving off
    `pdf.js` / `pdf-lib` to a commercial SDK);
  - (d) a genuinely ambiguous product decision with no reasonable default.
- For anything short of that, pick the sensible default, note it in your summary,
  and continue. Acceptance criteria are self-checks, not approval gates.
- Never mark a stage done without its acceptance criteria verified against a real
  fixture PDF.

---

## 8. Build-vs-buy note

If, after Stages 4–8, in-browser fidelity or editing robustness is still not good
enough for production, evaluate a commercial web PDF SDK (**Apryse/PDFTron
WebViewer**, **PSPDFKit/Nutrient**, **Foxit Web**). They provide production-grade
rendering, a real content/annotation editing layer, and text handling that a
`pdf.js` + `pdf-lib` combination does not. The block model from section 4 stays
the source of truth either way, so adopting an SDK later is a renderer swap, not
a rewrite. Raise this as a decision point rather than deciding unilaterally.
