# AutoSpec Studio — Progress & Handoff (continue here)

> Read order for a fresh session: `CLAUDE.md` (non-negotiables) → `docs/AutoSpec-directive.md`
> (the staged plan C.0–C.9, source of truth) → this file (what's done, gotchas, how to continue).
> Domain facts: `docs/AutoSpec-brief.md`. Hebrew, RTL throughout.

## TL;DR
We executed the directive in order. **All stages 0–7 are done and verified.** The full pipeline works:
**learn a TemplateSpec from same-family PDFs → generate a catalog DocumentIR from slot bindings → edit it in
the IR editor → export a real vector Hebrew PDF**, alongside the original **import an external PDF → IR → edit →
export** path. No simulated steps anywhere.

**Now in: Phase "usable on a real catalog"** (`docs/PHASE-usable-on-real-catalog.md`) — hardening, not breadth.
Milestone A ✅ (end-to-end on the real Peugeot family, image export, export wired into the editor). Next:
B auto-fit, C IndexedDB persistence, D structured-data ingestion. See "Phase milestones" below.

The **new app** lives in `src/` (Vite + React + TS). The old design prototype is reference-only at
`legacy.html` / `src/legacy/`. Do NOT build on the prototype (raster/overlay) — build on the IR.

## How to build / run / verify
```
npm install
npm run dev                 # new app at /  (prototype at /legacy.html)
npm run build               # tsc (noEmit typecheck) + vite build -> dist/
npm run stage0              # regenerate the Stage-0 Hebrew gate PDF
npx vite build --config vite.singlefile.config.ts   # -> dist-single/index.html (one self-contained file)
```
- Deliverable to the user each round: copy `dist-single/index.html` to `AutoSpec-Studio-app.html` and send it
  (single offline file; open by double-click, or `npm run dev`, or drag to app.netlify.com/drop).
- **No browser is available in this environment.** Verify headlessly with:
  - `npx tsx <script>.mts` running real modules over `project/uploads/**/*.pdf` (pdf.js legacy build works in Node).
  - **jsdom** (`/tmp/node_modules/jsdom`) + esbuild-bundling a tiny entry to mount React and assert DOM.
  - **@napi-rs/canvas** to render pdf.js pages / decode image objects in Node (note: it crashes on `paintChar`
    text drawing — wrap render in try/catch; image objects still resolve).
  - **PyMuPDF** (`python3`, `pip install pymupdf`) to render any PDF page to PNG and `Read` it to SEE results.
  - **TRUST PIXELS OVER YOUR OWN HEBREW READING.** I misread RTL several times; always confirm with an
    unambiguous marker (a number like `3008`, or the word `שלום`) or by pixel-diffing against the original.

## Architecture actually implemented (matches CLAUDE.md non-negotiables)
- **IR is the source of truth** (`src/types/catalog.ts`): `DocumentIR → PageIR → BlockIR` (TextBlockIR /
  ImageBlockIR). Coords in **PDF points, top-left origin**. RTL is a text property, never a coordinate hack.
- **Import** (`src/pdf/importPdf.ts`): pdf.js (`pdfjs-dist`) → IR. Text via `getTextContent` (logical order).
  Images via a **single `getOperatorList` walk** with a CTM stack (`src/pdf/extractImages.ts`).
- **Reference raster** = per-page preview (`renderPageCanvas`) used ONLY for Original/Compare view; never edited on.
- **Editor** (`src/app/PageView.tsx`, `src/editor/`): renders FROM the IR. Modes: Original / Editable /
  Reconstructed / Compare. Text edits via a `<textarea>` overlay in SCREEN coords (the page is sized directly,
  **no CSS transform:scale**, so the caret is stable). Click=select, drag=move, dbl-click=edit, corner handles=resize.
- **Export** (`src/pdf/exportPdf.ts`): real **vector** PDF via `pdf-lib` + `@pdf-lib/fontkit`, embedded Hebrew font.
- **Build**: Vite + TS, React 19. `tsc` is `noEmit` (typecheck only); Vite builds from `.tsx`.

## Stage status
- ✅ **0 (C.2) gate** — Hebrew round-trips through pdf-lib. User-confirmed.
- ✅ **1 (C.3)** — Vite/React/TS build; no Babel-in-browser; data out of HTML.
- ✅ **2 (C.4)** — real PDF import → IR (logical Hebrew, points). New app: ImportScreen + PageView (selectable text).
- ✅ **3 (C.5)** — IR-as-truth editor: textarea overlay, 4 view modes, move/resize, props panel
  (text, font size, **bold, colour, line-height**, align, w/h). Brand font applied.
- ✅ **4 (C.6)** — real vector export (glyph-positioned, see gotcha #2).
- ✅ **5 (C.7)** — images: extracted to IR, render in editor, move/resize/replace/fit(cover|contain|fill)/reset.
  Plus the **image/text separation fix** (FIX-image-text-separation spec) — see gotcha #4.
- ✅ **6 (C.8)** — real template learning: `learnTemplate(docs[])` → editable `TemplateSpec` JSON. Roles +
  slots from the IR; **fixed vs dynamic from real cross-document comparison** (see "Stage 6 as built"). UI:
  "למידת תבנית" screen (multi-PDF import → review/correct slots → save/download). `npm run verify:learn` gates it.
- ✅ **7 (C.9)** — catalog generation: `generateCatalog(spec, bindings)` → real editable `DocumentIR` (fixed slots
  emit learned content, dynamic slots take user text/images, unbound fall back to the learned sample). Opens in the
  SAME editor and exports via the SAME vector pipeline. UI: "יצירת קטלוג" screen. `npm run verify:gen` gates it
  (learn→generate→export round-trip; Hebrew order pixel-confirmed via PyMuPDF on the generated cover).

## CRITICAL GOTCHAS (hard-won — do not regress)
-1. **Bold + transparent-image (browser) fixes.** (a) **Bold**: pdf.js text items carry an internal
    `fontName` (`g_d0_f1`) that never reveals weight; resolve the REAL name via `page.commonObjs.get(name).name`
    (after the op-list walk populates commonObjs) and test it for bold — that's how `extractLayout` sets
    `fontWeight`. Export embeds BOTH weights (`loadExportFonts`) and `drawTextBlock`/`drawTableBlock` pick the
    bold face for `fontWeight>=600`; the editor registers a 700 `@font-face`. (b) **Black swatches**: in the
    BROWSER pdf.js hands image objects as an `ImageBitmap` (the `bitmap` branch of `objToDataUrl`); we MUST read
    the pixels back to detect alpha, else an SMasked transparent swatch is saved as opaque JPEG and its
    transparent areas turn BLACK. Gates: bold checks in `verify:structured`, bitmap-alpha checks in `verify:images`.
0. **Export must NOT re-wrap single-line imported text** (`exportPdf.planTextLines`). The imported box
   width was measured in the ORIGINAL font; the embedded Peugeot font is slightly wider, so wrapping a
   one-line box spilled a 2nd line DOWN onto the next block → text appeared doubled/overlapping in the PDF
   (but looked fine in the editor, which clips via `overflow:hidden`). Fix: a single-line box (height ≈ one
   line) is never wrapped — keep the whole line and shrink to ≥72% to fit the width; taller boxes wrap and
   clip extra rows. Every text block is also clipped to its box on export (WYSIWYG safety net). The editor
   renders one-line boxes with `white-space:nowrap` to match. Gate: the `planTextLines` checks in
   `verify:structured`. Do NOT "simplify" export back to always `wrapText`.

1. **Hebrew is LOGICAL in the IR.** pdf.js `getTextContent().str` and PyMuPDF both return logical order.
   Do NOT reverse at extraction. The terminal's own bidi makes printed strings *look* logical even when
   reversed — never judge order from a console print.
2. **Vector export must position EACH GLYPH at an explicit x** (`exportPdf.ts`). pdf-lib has no bidi, so we
   reorder logical→visual (`src/pdf/hebrew.ts`, `bidi-js`), BUT PDF *viewers* re-apply bidi to a Tj string by
   auto-detected base direction → a visual string that starts with Hebrew gets reversed AGAIN (numbers like
   `3008`→`8003`). Drawing one glyph per `drawText` defeats viewer re-bidi. Don't "simplify" back to one drawText.
   `hebrew.ts` also forces brackets enclosing an LTR run to LTR level so `(EV6)` isn't mirrored.
3. **Editor text = textarea overlay, transparent bg, no mask.** The page is NOT `transform:scale`d (sized by
   `*scale` directly) so screen px == overlay coords. Do not reintroduce a white mask behind edited text.
4. **Image/text separation (was the nastiest bug).** Image blocks must be the CLEAN image object, never a crop
   of the flattened preview (which has baked text → duplicated text). `extractImages.ts` resolves a clean source
   per region: (i) inline image data, (ii) named XObject via `page.objs.get(name, callback)` **awaited after
   `getOperatorList`** (works even when the browser releases objects post-render), (iii) RGBA/data decode (PNG if
   alpha, JPEG if opaque). Render-crop is FORBIDDEN when a clean source exists; the only last-resort fallback
   crops with overlapping text **erased** and logs loudly. Overlap is normal — NEVER merge/drop blocks; text is
   a separate block above images (paint order). **Verification gate: 0 render-crop fallbacks on pages 1/4/6.**
5. **Single-file build**: pdf.js worker is inlined via `?worker&inline`; `vite-plugin-singlefile` inlines JS/CSS;
   brand OTF imported from `src/assets/*.otf?url` so it inlines too. Keep it offline-capable.
6. **Don't commit compiled `.js`** next to `.tsx` (Vite resolves `.js` first → stale shadow). `tsc` is `noEmit`;
   `src/**/*.js` is gitignored.

## Key files
- `src/types/catalog.ts` — IR types.
- `src/pdf/importPdf.ts` — orchestrates import. `extractLayout.ts` (text), `extractImages.ts` (images, op-list
  walk + clean resolve), `renderPage.ts` (preview canvas + crop helpers), `hebrew.ts` (logical→visual bidi),
  `exportPdf.ts` (vector export).
- `src/app/` — `main.tsx`, `App.tsx` (shell, modes, props panel), `ImportScreen.tsx`, `PageView.tsx` (canvas:
  render + select/move/resize for text & images), `brandFont.ts` (detect brand, @font-face, Peugeot OTF).
- `src/editor/` — `coords.ts` (point↔px), `TextEditOverlay.tsx` (textarea editor).
- `src/templates/` — `templateSpec.ts` (TemplateSpec types + `detectFormat`), `templateLearning.ts`
  (`learnTemplate`, region clustering, role/slot detection, cross-doc fixed/dynamic), `storage.ts` (save/list/
  download JSON). `src/app/TemplateScreen.tsx` — the learning UI. `scripts/verifyTemplateLearning.mts` — its gate.
- `src/catalog/generateCatalog.ts` — Stage 7 generation (spec + bindings → DocumentIR). `src/app/GenerateScreen.tsx`
  — the generation UI. `scripts/verifyGenerate.mts` — its gate (`npm run verify:gen`).
- `src/stage0/makeHebrewPdf.ts` + `scripts/stage0.ts` — the Stage-0 gate artifact.
- `legacy.html` + `src/legacy/legacy-app.jsx` (generated by `scripts/build-legacy.mjs` from `project/*.jsx`) —
  the OLD prototype, reference only.
- Inputs: `project/uploads/{PEUGEOT,CITROEN}/PRIVATE/*.pdf`, `src/assets/PeugeotNewHebrew-*.otf`.

## Brand fonts
Peugeot OTF is embedded (`src/assets`, applied in editor + available for export). **Citroën font was never
supplied** → Citroën falls back to a Hebrew system stack (Assistant/Heebo). If the user uploads CitroenType,
add it in `src/app/brandFont.ts` (and embed in export).

## Stage 6 (C.8) — template learning — AS BUILT
- **`src/templates/templateSpec.ts`** — `TemplateSpec` (brand/family/format · `tokens` · `pages[]`) where each
  page has a `role` + `slots[]`; `SlotSpec { kind, blockType, dynamic, bbox, style, label, sample, fixedContent,
  confidence, variants, crossDocEvidence }`. `detectFormat()` keys the family by page geometry
  (print-spread / square / deck-16x9 / a4) — so same-brand-but-different-format catalogs (Citroën C3 16:9 deck
  vs C3 Aircross square) are correctly treated as **different families**.
- **`src/templates/templateLearning.ts`** — `learnTemplate(docs: DocumentIR[])`:
  1. **Regions**: union-find clustering of per-line text runs into logical regions (paragraph/heading/table) by
     proximity + font-size similarity (so a heading never merges into body; a whole spec grid collapses to one).
  2. **Roles**: `classifyPage()` — cover (page 0) · spec (dense small-font grid, small/n≥0.55) · back (legal/
     pollution near end) · colors · safety · price · feature (heading+image) · content. Each carries `roleEvidence`.
  3. **Slots**: narrative pages → one slot/region; dense pages consolidate (spec→heading+spec-table, colors→
     colors+wheels, back→legal+pollution).
  4. **Fixed vs dynamic from REAL cross-doc evidence**: pages align by index (same family shares a skeleton),
     regions match by IoU; a region whose text is **identical across models = fixed**, one that **differs =
     dynamic** (conf 0.9). With a single doc it falls back to content heuristics (model-token / dynamic-kind).
- **UI**: `src/app/TemplateScreen.tsx` (reached via "למידת תבנית" on the import screen) — drop 1+ PDFs → real
  import + learn → review page roles, click slots to correct kind / fixed↔dynamic / label → **save** (localStorage,
  `src/templates/storage.ts`) and **download** the `TemplateSpec` JSON. No simulation; every step is a real artifact.
- **Verify**: `npm run verify:learn` imports the real 3008 + 5008 and asserts roles, the dynamic cover model-name,
  spec consolidation, and that cross-doc comparison produced both fixed and dynamic slots. (Measured on 3008↔5008:
  19 pages, 119 slots, 81 dynamic / 38 fixed, 81 with cross-doc evidence.)
- NOTE: text colour in the IR is still the placeholder `#111418` (extractLayout TODO), so `tokens.accent` is
  flagged `accentDynamic:true` per the brief but not yet measured — wire it when op-list colour refinement lands.

## Stage 7 (C.9) — catalog generation — AS BUILT
- **`src/catalog/generateCatalog.ts`**:
  - `generateCatalog(spec, bindings, opts?) → DocumentIR` — one `PageIR` per template page; each `SlotSpec`
    becomes a real `BlockIR` (images under text by slot order). Fixed slots emit `fixedContent` + learned
    `style`; dynamic slots emit the user's bound text/image, or fall back to the learned `sample` as an editable
    placeholder. Unbound image slots get a labelled SVG placeholder. `brand` carries through → brand font in editor/export.
  - `validateCatalog(spec, bindings)` → missing **required** dynamic slots (`REQUIRED_KINDS` = model-name, hero-image).
  - `dynamicSlots(spec)` → the fillable slots, flattened for the binding form.
- **UI**: `src/app/GenerateScreen.tsx` (reached via "צור קטלוג", or the button on the template-review screen) —
  pick a saved/just-learned template → fill dynamic slots (textarea / image picker, prefilled with the sample) →
  "צור קטלוג" validates required, runs `generateCatalog`, and opens the result in the SAME editor (`App.openDoc`).
- **Verify**: `npm run verify:gen` — learn 3008+5008 → bind a new model-name → generate (19 pages, 119 text blocks)
  → **real vector export** (`%PDF`, ~274KB). Hebrew order on the generated cover was pixel-confirmed with PyMuPDF
  ("פיג׳ו 408 · 130 כ״ס" renders RTL with digits un-reversed).

## Phase "usable on a real catalog" — milestones
Spec: `docs/PHASE-usable-on-real-catalog.md`. Hardening only — NO new slot types/templates/effects/print.
Verification gates (all headless, real PDFs): `npm run verify:learn|gen|milestone-a|shapes|images|autofit|persistence|structured`.

- ✅ **Design fidelity (user-requested)** — vector panels/strips/swatches extracted into the IR; tables reproduced
  cell-by-cell with gridlines (`design[]` layer); photos extractable headlessly. See "Design-fidelity pass" below.
- ✅ **C — project persistence (IndexedDB)** (`src/store/db.ts` + `src/store/library.ts`). Templates library
  (save/list/get/duplicate/delete, with a source-page thumbnail) and Projects (save/open in-progress catalogs =
  DocumentIR + embedded assets). `App` autosaves the open catalog (debounced) with a "✓ נשמר" indicator;
  `ImportScreen` is now a home/library showing saved templates (→ צור קטלוג) and in-progress projects (→ פתח),
  each with open/duplicate/delete. Templates moved off localStorage onto IndexedDB (handles the large image data
  URLs). Gate `npm run verify:persistence` (fake-indexeddb): save → simulate reopen → template + project still
  there and round-trip; duplicate/delete work.
- ✅ **B — generation-time auto-fit** (`src/catalog/autofit.ts`). Before opening/exporting, each text block is
  MEASURED vs its box and: font shrinks to an 85% floor → wraps → box grows within page bounds → else **flagged**
  (never silently clipped). `exportPdf` now WRAPS each line to the box width (matches the DOM editor) so long lines
  don't overflow horizontally. RTL preserved (wrap on words in logical order; visual order applied at draw).
  Run in `GenerateScreen` via a canvas measurer; gate `npm run verify:autofit` (long marketing text + long cell →
  fits or flagged, font never below floor, real PDF). NOTE: row-overflow continuation (more rows than the template)
  is deferred to Milestone D (structured table) — cell text auto-fits, but extra ROWS need the structured model.
- ✅ **A — end-to-end on ONE real family.** Fixed the two real-data breaks: (1) **vector export now embeds
  images** (`exportPdf.ts`: PNG via `embedPng`, JPEG via `embedJpg`, drawn under text in zIndex order; cover/
  contain/fill with a pdf-lib clip rect for cover; full source bytes, **no downsampling**; unembeddable/unbound
  → neutral frame rect). (2) **Export is wired into the editor** — `App` "ייצוא PDF" button → `loadExportFont`
  (`brandFont.ts`, brand OTF or Peugeot Hebrew as a generic embed) → `exportPdf` → real file download. Confirmed
  no simulated progress survives in the real app (only `legacy/` has fake `setTimeout` bars). Gate:
  `npm run verify:milestone-a` (learn 3008+5008 → generate "פיג׳ו 408" → stream a real image asset → edit a
  heading → export). Pixel-confirmed with PyMuPDF: cover shows the hero photo + logo + "פיג׳ו 408 — חוויה חדשה"
  in correct RTL order, 2 images embedded, text selectable/vector.
- ✅ **D — structured-data ingestion** (`src/data/`). Excel/CSV/XLSX → a brand-neutral `SpecSheet`
  (spec table + equipment features + colours + wheels + marketing/legal/price) → mapped onto a learned
  template → catalog. See "Milestone D — AS BUILT" below. Gate `npm run verify:structured`.

## Design-fidelity pass (user-requested; "make it look like a catalog")
After Milestone A the user judged generated pages too plain (missing panels, broken tables). Fixed:
- **Vector shapes (panels / accent strips / colour swatches) now extracted** in the SAME op-list walk
  (`extractImages.ts` → `walkPage` returns `{images, shapes}`; `ShapeBlockIR` in `catalog.ts`). Fill colours come
  straight from the fill ops (setFillRGBColor/Gray/CMYK) — **no raster sampling, so shapes extract headlessly**.
  Rendered in `PageView` (under images/text) and drawn in `exportPdf` (`drawRectangle`, z-ordered).
- **Carried through learn → generate.** Shape regions become `background` slots; cross-doc fill comparison marks a
  **per-model accent strip dynamic** and shared panels fixed. `generateCatalog` emits `ShapeBlockIR`. Gate: `npm run verify:shapes`.
- **Tables no longer collapse.** Reverted the Stage-6 dense-page consolidation: every positioned text run stays its
  own slot, so generation reproduces the spec/safety grid (cross-doc → fixed column labels + dynamic values) instead
  of one blob. Pixel-confirmed: generated 3008→408 spec page renders the full two-column table over the gray panels.

## Milestone D (structured-data ingestion) — AS BUILT
Chosen with the user: **data source = Excel/CSV upload** (not PDF re-extract), **scope = spec + features +
colours**, **Peugeot/Citroën first** (MG is a different importer — different schema + a GRAPHICAL pollution
scale that won't text-extract — explicitly deferred). Grounded in the 8 real brochures the user uploaded
(Peugeot 3008/408/Rifter, Citroën C3/C5 Aircross/Berlingo, MG HS PHEV / S9).
- **`src/data/specModel.ts`** — the brand-neutral `SpecSheet` (the "car-comparison schema"): `trims[]`,
  `sections[{title, rows[{label,unit,values[]}]}]`, `features[{title, items[{label, perTrim[]}]}]`,
  `colors[]`, `wheels[]`, `marketingText/legalText/price`. `normalizeSheet` enforces the invariant
  *values align to trims* (a single value broadcasts across finishes).
- **`src/data/parseSheet.ts`** — zero-dependency spreadsheet reader (single-file-build safe). CSV/TSV with
  delimiter auto-detect + BOM + quotes; **real .xlsx** via a minimal ZIP reader + `DecompressionStream`
  ('deflate-raw', present in the browser AND node 22) + sharedStrings/sheet XML. `toCSV` writes UTF-8+BOM.
- **`src/data/specSheetFormat.ts`** — the canonical **tagged** sheet (col-A record tag, Hebrew/English
  aliases: `spec|מפרט`, `feature|אבזור`, `color|צבע`, `wheel|חישוק`, `meta|מטא`, `trims|גרסאות`,
  `marketing/legal/price`). `cellsToSheet` parses + collects `SheetIssue[]` (unrecognised rows surfaced,
  never silently dropped); `sheetToCells`/`blankTemplateCells` write a self-documenting template. A dealer
  fills it in Excel and "Save As CSV".
- **`src/data/specToBlocks.ts`** — `buildSpecTable` emits a **first-class editable `TableBlockIR`** (new IR
  type, `src/types/catalog.ts`): logical columns (0 = label, RTL-rendered on the right), header/section/data
  rows, fitted `rowHeight`. `layoutFeatures` (✓ per trim) and `layoutColors` (swatch+name+type, wheels) still
  flatten to text/shape lists. (`layoutSpecTable` multi-column flow is kept as an alt but unused.)
- **`TableBlockIR` end-to-end**: rendered in `PageView` (cells + gridlines, **double-click a cell = inline
  edit**), drawn glyph-by-glyph RTL in `exportPdf` (`drawTableBlock`, shared `columnLeftFraction`), and edited
  in `App`'s props panel (font/row-height, **add data-row / add category / delete row, add/remove trim column**;
  resize recomputes `rowHeight`). Serialises as plain JSON → persists in IndexedDB unchanged.
- **`src/data/mapSheetToCatalog.ts`** — orchestrator: auto-binds simple text slots (model-name←brand+model,
  marketing/legal/price), rebuilds `spec`/`colors`/`safety` pages from the sheet (keeping only the learned
  **panels**, dropping the OLD table's gridlines), and returns a **mapping report** (`mapped` vs `manual`)
  so unmapped fields (hero/interior images, anything not in the sheet) are clearly surfaced for manual fill.
- **`src/data/samples.ts`** — `peugeot3008Sheet()`: a REAL SpecSheet transcribed from the 3008 MHEV brochure
  (p13 spec + p15 equipment). Drives the "טען דוגמה אמיתית" button, the real-data template, and the gate.
- **UI** (`src/app/GenerateScreen.tsx`): a "נתונים מובנים (Excel/CSV)" panel — upload / load-real-example /
  download-template / download-as-CSV, a parse summary, the mapping report (green ✓ mapped, amber ✎ manual),
  warnings, and an issues `<details>`. When a sheet is loaded, "צור קטלוג" runs `mapSheetToCatalog` (manual
  form still supplies images/overrides as the fallback), else the Stage-7 slot path. Auto-fit + same export.
- **Verify**: `npm run verify:structured` — round-trips the real sheet through CSV **and TSV and a real
  .xlsx** (deflate + shared strings, byte-identical stats), surfaces a malformed row as an issue, maps onto
  the learned 3008+5008 template (asserts real values `453.5`/`1,199`, trim header `GT`, section `מידות`,
  model-name + marketing mapped, hero image surfaced as manual), and exports a **real vector PDF**.
  Pixel-confirmed with PyMuPDF: the spec page renders as a 2-column RTL table (numbers un-reversed) and the
  colours page shows swatches + names + wheels.
- **Citroën** uses the SAME Stellantis schema (confirmed on C5 Aircross) → the same canonical format covers
  it; only a Citroën-named sample would differ. **MG deferred** (different importer schema + graphical scale).
- The spec table is a first-class **`TableBlockIR`** (user-requested): edit a single cell in the editor
  (double-click) or add/remove rows + trim columns from the props panel — no need to re-upload a whole sheet.
  Headless learn still has no photos, so the gate injects a hero-image slot to exercise the manual path.
- NOTE: the spec table is a single rectangular grid right-aligned in the page (label + trim columns), so on a
  wide print-spread the left half is whitespace; the user can widen/move it. A 2-column auto-flow is a possible
  future refinement. `base` font for a dense page = the SMALLEST styled slot font (the spec small-print),
  clamped — never a big heading (which would inflate row height).

## Open follow-ups (not blockers; some folded into the phase)
- Text colour refinement (op-list) → real `tokens.accent` per model (text colour still placeholder `#111418`;
  shape/panel colours ARE now real).
- **Interior generated pages still lack PHOTOS in a headless learn** (image extraction needs the browser canvas).
  In the actual app (browser learn), interior image slots are learned and generated pages carry the source photos.
  A headless image path (napi-canvas) would let the gates show photos too.
- Spec tables are positioned cells (grid reproduced visually); a real `TableBlockIR` + gridlines could come from
  source Excel (Milestone D).

## Domain facts to reuse (measured; see brief for full table)
- 6 brands: Peugeot · Citroën · Opel · DS · IM · MG. Multiple templates per brand (NOT one).
- Formats differ even within a brand: print spreads (square cover ≈595² + 1191×595) vs a 16:9 deck (C3, 1920×1080).
- Available source PDFs: Peugeot 208/3008/5008/Rifter; Citroën C3/C3 Aircross/C5 Aircross. (No Berlingo/Jumpy PDF.)
- Spec tables are positioned text (~22 cols × ~38–40 rows), not real tables — prefer source Excel when available.

## Commit history (newest first)
Stage 7 catalog generation → Stage 6 template learning (IR-based) → image/text separation fix → image doubling
fix → Stage 5 images → editor move+tools → brand font/no-mask/resize → single-file build → RTL export
glyph-positioning → Stage 4 export → Stage 3 editor → Stage 2 import → Stage 1 Vite migration → Stage 0 gate.
(See `git log`.)
