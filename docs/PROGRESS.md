# AutoSpec Studio — Progress & Handoff (continue here)

> Read order for a fresh session: `CLAUDE.md` (non-negotiables) → `docs/AutoSpec-directive.md`
> (the staged plan C.0–C.9, source of truth) → this file (what's done, gotchas, how to continue).
> Domain facts: `docs/AutoSpec-brief.md`. Hebrew, RTL throughout.

## TL;DR
We executed the directive in order. **All stages 0–7 are done and verified.** The full pipeline works:
**learn a TemplateSpec from same-family PDFs → generate a catalog DocumentIR from slot bindings → edit it in
the IR editor → export a real vector Hebrew PDF**, alongside the original **import an external PDF → IR → edit →
export** path. No simulated steps anywhere.

Against the uploaded **Rebuild-Brief (stages 0–9)**: stages 0–8 map onto the above and are done; **stage 9
(persistence + PWA) is now also complete** — IndexedDB was done (Milestone C), and the offline **PWA app shell**
was added this session (service worker + manifest + icons; gate `npm run verify:pwa`; see "Round 11").

**"Usable on a real catalog" phase** (`docs/PHASE-usable-on-real-catalog.md`) — hardening, all milestones done:
A ✅ (E2E on the real Peugeot family + image export), B ✅ (auto-fit), C ✅ (IndexedDB library/projects),
D ✅ (Excel/CSV structured-data ingestion). See "Phase milestones" below. All 11 `verify:*` gates pass.

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
- **A real Chromium IS available** (playwright-core + /opt/pw-browsers): `npx vite preview --port 4173 &`
  then `node scripts/e2eSmoke.mjs [pdf]` → screenshots + a real exported PDF in `e2e-out/`. Use it to SEE
  the app. For pure logic, verify headlessly with:
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
- ✅ **8 — high-fidelity Hebrew export** — `exportPdf` (vector, `@pdf-lib/fontkit`, `bidi-js`, embedded images
  + shapes + tables). Gated by every `verify:*` that ends in "export produced a real PDF".
- ✅ **9 — persistence + PWA/offline** — IndexedDB library/projects (Milestone C) **+ this round's PWA layer**
  (see "Round 11"). `npm run verify:persistence` + `npm run verify:pwa`.

## Round 14 — ROOT table fix: reconstruct whole tables (not row-by-row) + heritage/yellow
User feedback on the real Opel Frontera catalog: (a) equipment table read as spec-table, (b) the
spec table still detected row-by-row (Round 13's rows weren't enough — wanted ONE table), (c) yellow
section-band bleeds over the whole table in the editor, (d) heritage pages mis-roled. Root fixes:
- **`src/templates/tableDetect.ts`** — reconstruct a page's TABLES (rows × columns) from positioned
  cells and emit ONE editable `table` slot per table (backed by the existing Milestone-D
  `TableBlockIR`), not a box per cell/row. Robust column clustering by a STABLE right-edge anchor
  (running average — the naive expanding-bbox version ran away and swallowed the page); tables split
  by pairing each Hebrew LABEL column with the value columns to its reading-left (keeps two
  interleaved side-by-side tables separate); sparse outlier columns (a car's dimension callouts) and
  big TITLE cells (the page heading) are excluded so they don't bloat/absorb into the grid.
- **SlotSpec gains `blockType:'table'` + a `table` payload**; `generateCatalog` emits a `TableBlockIR`
  (white `cellBg`, RTL) → opens in the SAME editor and exports via the SAME vector pipeline.
  Pixel-confirmed: generated C3 spec page renders as two clean RTL label→value tables.
- **`tableKind`**: numeric grid ⇒ `spec-table`; a checkmark-only (V-per-trim) grid ⇒ `equipment`
  (fixes "אבזור → מפרט טכני"); a tyre/wheelbase row no longer hijacks the whole table to `wheels`.
- **Yellow bleed** (`extractImages`): white cell-fills painted ON TOP of a coloured section band were
  dropped as "background", so the band showed through the whole column in the editor. Now a white
  fill that OCCLUDES an earlier coloured panel is kept.
- **Role fixes**: heritage/timeline (years, few units) ⇒ `feature` and wins over the data branches;
  a lone ₪ in prose no longer ⇒ `price` (needs ≥2 price cues); a colours list keeps `colors`.
- Verified across 6 catalogs; all 11 `verify:*` gates pass (`verify:learn` now asserts whole-table
  slots, not per-cell); `tsc` clean; both builds green.

## Round 13 — template-learning quality: misclassification + table/paragraph fragmentation
User feedback: learning mis-assigned regions and split a paragraph/table into many line/word boxes.
Diagnosed on real PDFs (rendered with PyMuPDF, trusted pixels), fixed at the root:
- **Data kinds gated to data pages** (`slotKind`): a `spec-table`/`safety`/`equipment`/`colors`/…
  kind is assigned only on an actual data-role page. Marketing/feature/cover/interior pages
  (`MARKETING_ROLES`) get heading/model-name/marketing/hero/logo/legal only — even when the copy
  mentions "מערכת"/units/numbers (fixed a 4-up safety FEATURE spread being tagged spec-table/safety).
- **Table cells → rows** (`groupRegions` new `'row'` mode + `clusterTableRows`): a dense table now
  groups into label→value ROWS instead of ~3N word-cells or column blobs. Robust to two side-by-side
  RTL tables that INTERLEAVE in x (measured: intra-table label→value gap > the gap between tables) —
  a Hebrew label OPENS a row and absorbs the value cells to its reading-left, back to the next label,
  so each table keeps its own values. Section headers stay their own rows.
- **Dense detection made format-relative + marketing-proof** (`isDensePage`): "small font" is now
  relative to the page's heading (a 1920×1080 deck's 15pt body was missed by the old absolute `<10`,
  so its spec tables blobbed into columns); and a page is NOT dense when images cover ≥25% of it (any
  number of hero images, not just one ≥22%) or it is mostly long-sentence prose. `classifyPage` now
  shares this `isDensePage` verdict, so image/prose marketing pages stop being read as safety/spec.
- Verified visually (learn overlays on Citroën C3 p8 feature + p9 spec) and headlessly: all 11
  `verify:*` gates still pass; `tsc` clean; both builds green.
- **Cross-catalog check (root vs C3-only)**: ran the same failure metrics over 9 catalogs (Peugeot
  208/3008/5008/Rifter/Boxer, Citroën C3/C3-Aircross/C5-Aircross/Berlingo). Result: **data-kind
  leakage onto marketing pages = 0 everywhere** (kind fix is general); **column-blobbing = 0 on
  7/9**. Fixed a self-inflicted regression along the way — the marketing-image guard was demoting
  SPEC pages that carry a big dimension DIAGRAM (30-40% image area, e.g. 208 p5, Boxer p2) out of
  row mode; added a **grid-of-short-cells primary signal** (`shortCells ≥ 60%` ⇒ dense table) that
  wins over the image guard. Remaining residuals are HONEST limitations, not C3 overfit: (a) a
  couple of heritage/timeline pages are mis-ROLED (e.g. C3-Aircross p1 → price) — text still
  clusters fine, only the role label is off; (b) a MATRIX table (trims as columns, bare-value grid,
  e.g. C5-Aircross p10) still blobs — the label↔value row-pairing doesn't model a pure value matrix.
  Both are correctable in the review UI / AI-assist; full row×col table-structure detection is the
  next step if needed.

## Round 12 — real text colours (op-list) + headless photo path (open follow-ups closed)
Closed the two "open follow-ups" that were left as non-blockers:
- **Real per-run text colour from the op-list** (`extractImages.walkPage`): tracks the text matrix
  (BT/Tm/Td/T*/TL) + `setTextRenderingMode` and records the **exact fill colour** at each `showText`
  baseline (`TextColorSpan[]`). `importPdf.assignOpListColors` matches spans to the clustered text
  blocks by position and sets each block's colour — **PRIMARY** and **headless** (no raster). The
  browser raster sampler (`sampleInkColor`) now only fills blocks the op-list didn't match
  (Type3/path-drawn text). Invisible OCR text (render mode 3/7) is ignored; near-white kept only over
  a captured dark backdrop. Measured on 3008: 668 text blocks → real colours (`#000000`, white-on-dark,
  Peugeot red `#ba0500`, blue `#14a2dd`); ~88% non-placeholder.
- **`tokens.accent`** (`templateLearning`): now a REAL value — the dominant SATURATED (non-gray)
  text colour across the learned docs (was always undefined). `accentDynamic` still true per the brief.
- **Headless photo path in the learn gate**: `verify:learn` now imports with a `@napi-rs/canvas`
  factory (`renderPreviews:true, makeCanvas`), so the learned template carries **52 real image slots**
  headlessly (was 0). New assertions: image slots ≥3, real-colour ratio >0.6, `tokens.accent` saturated.
- No regression: `tsc` clean, both builds green, **all 11 `verify:*` gates pass**.

## Round 11 — Stage 9 PWA / offline app shell (uploaded Rebuild-Brief stage 9)
The IndexedDB half of stage 9 was already done (Milestone C); the **offline PWA app-shell** half was missing.
Added, dependency-free (no `vite-plugin-pwa`):
- **`public/sw.js`** — service worker: install-time **precache of the whole built asset list**
  (navigations network-first→cached shell; hashed assets stale-while-revalidate; cross-origin passthrough —
  the app is 100% same-origin, no CDN). Old caches purged on activate; `skipWaiting`+`clients.claim`.
- **`scripts/injectPrecache.mjs`** — post-build step (wired into `npm run build`): scans `dist/` and injects the
  37 hashed URLs into `dist/sw.js`'s `PRECACHE` placeholder (Vite hashes names we can't know when authoring the SW).
- **`public/manifest.webmanifest`** (RTL/he, `display:standalone`, theme `#1a1d23`) + **generated icons**
  (`scripts/genIcons.mjs` → `icon-192/512/maskable-512.png`, `icon.svg`). `index.html` links them.
- **`src/app/registerSw.ts`** — registers the SW, **guarded**: prod-only + http(s)-only, so `vite dev` (HMR) and
  the `dist-single/index.html` file:// deliverable (already fully offline, everything inlined) are untouched.
- **Gate `npm run verify:pwa`** (real Chromium, headless): loads the built app online → SW takes control →
  goes **offline** → reload → **app still mounts from cache**; asserts manifest + icons. Verified against `dist/`.
- Both builds still green: `npm run build` (multi-file + precache inject) and the single-file config.

## Round 10 — back-page class fixes (visual-order bidi, rotation, clip, occlusion) + soft scrim
- **Mixed-line run order**: generators emit mixed HE/EN lines in LOGICAL or VISUAL stream order —
  stream order is NOT reliable. Line joins (clusterTextBlocks + regionText) now order runs by
  POSITION (x-descending for RTL) — correct in both cases (dealer/phone lines now read right).
- **Rotated text**: angle captured from the text matrix (rotation on the block), rendered rotated in
  the editor (transformOrigin baseline-left) and exported via translate+rotate ops. Vertical
  sidebars ("10/2025") no longer overlap the layout. Rotated runs are excluded from clustering.
- **Fills now honour the ACTIVE CLIP** (was images-only): an unclipped capture painted invisible
  header bars over photos. Non-rect clips can't be represented — plus a rule that drops a full-bleed
  dark band lying entirely on an image (invisible-in-source header treatments).
- **bgWhite eraser**: a near-full-page white fill = the page background re-painted; it ERASES earlier
  covered shapes instead of being skipped (black bar under a white repaint no longer leaks).
- **Soft scrim**: the manual scrim is now a feathered-alpha PNG image block (smoothstep falloff on
  all edges) — soft like a real gradient, identical in editor and export, resizable, opacity slider.

## Round 9 — deep-diagnosis root fixes + holistic hardening
- **Import-time text clustering** (`extractLayout.clusterTextBlocks`, called in importPdf): pdf.js runs →
  LINES (same baseline, gap <0.9em, joined in CONTENT order — bidi untouched) → PARAGRAPHS (leading ≤0.55em,
  x-overlap, prose-only; a line sharing a y-band with another is a table ROW and never merges). C3 766→543
  blocks; spec grids keep per-cell blocks. Editor now shows paragraphs as single textareas.
- **Classifier bugs fixed**: unitCount/looksLikeSpec used NON-GLOBAL match() (always 1 — unit thresholds never
  worked); heritage/timeline pages (years, no units) were `spec` with 124 per-line slots — added years-vs-
  digitRatio guards in classifyPage AND isDensePage; numericSpec requires digitRatio ≥0.03; density thresholds
  retuned post-clustering (40→26). 3008/5008 now yield near-identical role sequences (cross-doc consistency).
- **Editor fidelity**: text box height ×1.3 (true glyph box ≈1.38×, measured vs PyMuPDF; top error only 0.09em
  — overlay pt→px mapping itself verified consistent). regionText joins by line+content order (not x).
- **Offline fonts**: UI fonts (Assistant/Rubik/JetBrains Mono, hebrew+latin woff2) bundled in
  `src/assets/fonts/` + fonts.css imported in main.tsx; the Google-CDN @import was REMOVED from legacy.css —
  the single-file build now keeps its typography with no network.
- **Editor perf**: drag/resize handlers rAF-throttled (was a full-page re-render per mousemove).
- **Editor completeness**: duplicate selection (Ctrl/⌘+D + toolbar שכפל), Escape clears selection.
- **Generation**: buildDoc also runs fitTableBlock on every generated table — no clipped cells on open.

## Feedback round 7 (AI-completion bugfix · Gemini 3 · brand logos · image crop)
- **AI-completion "nothing happens" FIXED**: two `[spec?.id]` effects fought — the reset effect ran
  AFTER the starter-seed effect and set `sheet=null`, so the "השלם את החסר" button was `disabled={!sheet}`.
  Merged into ONE effect (reset → seed). Button no longer gated on `sheet`; `runAiComplete` self-heals
  (creates a starter sheet if none) and always surfaces a status message ("פונה ל-Gemini…" / ✓ / error).
- **URL summarization**: paste a model-page URL → `extractUrls` detects it, the request enables the
  Gemini `url_context` tool (drops `responseMimeType` then, since tools+structured-output conflict) and
  the model reads+summarizes the page. Plain text and PDF upload still work.
- **Gemini 3 models**: `src/ai/models.ts` shared list (gemini-3-flash / -flash-lite first, 2.x as
  fallbacks); completion defaults to `gemini-3-flash`. Both AI selectors (learn + create) use it. (The
  earlier "no Flash 3.1" note was wrong about the generation — Gemini 3 Flash exists; integrated.)
- **Brand logos auto-embed** (`src/app/brandLogo.ts`, assets `logo-*.png` for peugeot/citroen/opel/mg/ds):
  `loadBrandLogoDataUrl` (→ data URL so export can embed it) is preloaded per `spec.brand`;
  `applyBrandLogos(doc, spec, logoSrc)` drops the logo into every detected `kind==='logo'` slot (matched by
  `${slot.id}_b` or box overlap → covers both generate + structured paths), `fit:'contain'`.
- **Image crop — manual + auto-detected**:
  - IR `ImageBlockIR.crop {fx,fy,fw,fh}` now RENDERED (PageView wrapper clips; img scaled/offset to the
    window) and EXPORTED (`drawImageBlock` crop branch: scale image so the window fills the box, clip rest).
  - Manual control: image panel "חיתוך תמונה" with left/right/top/bottom inset sliders + reset.
  - Auto-detect: `extractImages.walkPage` now tracks the active CLIP rect across save/restore; when a
    source clip cuts an image to 5–92% of its full rect, the VISIBLE region becomes the block box and the
    `crop` fraction is recorded — so images cropped in the original render the same in the editor/export.
    Verified on real PDFs (5/53 images cropped — not over-triggering); gate `verify:images` extended.

## Feedback round 6 (drive-type templates · AI completion · zoom · image frame · preview · brand folders)
- **Drive-type data templates** (`workbookAdapter.naturalTemplateSheets(drive, trims)`): engine + battery
  sheets tailored to `petrol|hybrid|phev|ev` (fields transcribed from the four real workbooks; `DRIVE_LABELS`,
  `HAS_BATTERY`). A drive-type `<select>` sits next to the Excel download in BOTH `TemplateScreen`
  (learn-mode, "הורד טבלת נתונים") and `GenerateScreen`. ⚠ signature is `(drive, trims)` — callers/gates pass
  drive FIRST (e.g. `naturalTemplateSheets('phev', ['GT','ALLURE'])`).
- **AI text completion in create-catalog** (`src/ai/geminiComplete.ts`): fills ONLY missing copy (marketing /
  equipment bullets / legal) from pasted text or an uploaded PDF (`src/pdf/pdfText.ts` extracts text via
  `getTextContent`). NEVER invents numeric spec/price (`parseCompletion` drops non-text fields). `applyCompletion`
  is merge-only-if-empty + dedupes feature items, spans all trims. Default model **gemini-2.5-flash** (smartest
  free Flash; there is NO "Flash 3.1"). UI: "✨ השלם עם AI" panel in the structured-data block. Gate `verify:ai` extended.
- **Canvas zoom** (`App`): `zoom` state independent of the page rail; header − / % / + control; `scale = fitScale * zoom`.
- **Image frame** (`ImageBlockIR.stroke {color,width}` + `radius`): editor draws an axis-aligned frame OUTSIDE the
  rotate/flip transform (a wrapper `<span>` + bordered overlay); export draws a `drawRectangle` border after the image.
  Panel: "קו מתאר" add/remove + colour + thickness + corner radius.
- **Create-catalog PREVIEW** (`GenerateScreen` → `PreviewModal`): `buildDoc()` factored out of `create()`; the
  preview renders each generated page read-only via `PageView mode="reconstructed"` (same renderer as the editor),
  with page nav + a thumbnail rail + "פתח בעורך ←". WYSIWYG of how the page looks with the resources added.
- **Home folders by brand** (`ImportScreen`): projects + templates grouped into collapsible per-brand folders
  (`groupByBrand` by `doc.brand` / `spec.brand`; `BRAND_HE` labels; "unknown" last; `BrandFolder` component).

## Feedback round 5 (undo/redo · image transforms · create-screen)
- **Undo/Redo** (`App`): history-aware `setDoc` that COALESCES rapid changes (a drag = one undo step);
  Ctrl/⌘+Z / Shift+Z / Ctrl+Y, header ↶ ↷ buttons (disabled when empty). `resetHistory` on open.
- **Image flip/rotate**: `ImageBlockIR.flipH` + `BlockIR.rotation`; editor via CSS transform, export via a
  pdf-lib matrix (clip to the box in page space, then translate-to-centre → rotate → flip → draw centred).
  Pixel-confirmed (rotated/flipped car, not black). Panel: ⇋ היפוך / ↺↻ 90°; reset clears them.
- **AI-assist (Gemini, optional)** — `src/ai/`: heuristics first, then "✨ שפר עם AI" refines roles/kinds via
  Gemini Flash (one request, text-only). Model selector + 429/auth retry+messages. OFF by default; key local.
  Gate `verify:ai` (parse/merge/immutability/invalid-enum).
- **Create screen**: the clear row-based `SpecSheetEditor` is now the PRIMARY view (opens by default with a
  starter sheet); generation uses the sheet only when it carries real data (`sheetHasData`), else the plain
  template path — so an empty starter never wipes the learned content.

## Feedback round 4 (real templates)
- **Natural multi-sheet workbook adapter** (`src/data/workbookAdapter.ts`) for the user's REAL Excel format:
  one TAB per category (יחידת הנעה / מידות ומשקלים / סוללה וטעינה → spec sections; בטיחות / אבזור → equipment
  feature lists with V/X per trim), col A = field label, cols B+ = value per trim, header row carries trim
  names or V/X. `parseToSpecSheet` auto-detects tagged vs natural (`isTaggedFormat`); `parseXlsxSheets`
  reads tabs WITH names. Verified on all four real drive-type files (3 spec sections + 2 feature cats each).
  V/X parsed correctly (V=included, X=NOT — `parseBool` treats X as true, so a dedicated `vxBool` is used).
- **`writeXlsx`** (STORE zip, browser-safe, CRC32): "הורד תבנית (Excel)" now hands back a 5-tab template in the
  user's own format (field labels pre-filled). Round-trips through the reader (gate).
- Gate `verify:structured` covers natural detection, V/X, and the template writer round-trip.

## Feedback round 3 (notes doc + fonts)
- **Citroën fonts embedded** (see Brand fonts). Editor + vector export now use CitroenTypeHebrew for Citroën.
- **Technical-spec vs equipment separation** (`classifyPage`): both are dense small-font pages, so density
  alone mislabelled equipment pages as spec. Now spec requires a NUMERIC signal (digit RATIO ≥ ~0.03 or
  ≥2 unit tokens); a dense page that is mostly SENTENCES → `safety` (equipment), not `spec`. Verified on
  3008/C5/RIFTER (equipment pages → safety, technical pages → spec). Holds for learning and generation
  (spec role → table, safety role → feature layout).
- **Row-based manual data editor** (`SpecSheetEditor`, in GenerateScreen via "✎ הזנה/עריכה ידנית"): clear
  rows that mimic the table, a HEADING per spec area (מנוע/מידות/היגוי…), unit + value-per-trim columns,
  add/remove rows + areas; equipment as sentence lists with a ✓ per trim; exterior/interior colours; wheels;
  texts. Trims add/remove updates every row. Far clearer than cube-by-cube cell editing.
- TODO: incorporate the user's fuller real template once uploaded (template still leans technical).

## Feedback round 2 (notes doc)
- **Multi-sheet .xlsx** (`parseSheet.parseXlsx`): reads EVERY worksheet (rows concatenated), so an
  "equipment" sheet next to a "spec" sheet is no longer ignored. Comprehensive **downloadable template**
  (`blankTemplateCells`) covers every field incl. safety/equipment + exterior/interior colours.
- **Exterior vs interior colours**: `ColorEntry.group`, tags `color` / `colorint`; `layoutColors` shows two
  groups; new SlotKinds `equipment`, `colors-interior`; content-driven classifier emits them.
- **Slot label auto-updates with kind**; `SLOT_LABEL` exported; TemplateScreen kind list grouped + shows labels.
- **Table cell background** (`TableBlockIR.cellBg`) — one control sets all cells (editor + export).
- **Generated-catalog thumbnails** (`thumbnail.renderThumbnail`) — pages with no source raster now show their
  real layout in the rail (was blank white).
- **Editor**: RTL/LTR direction toggle on text. **GenerateScreen**: remove a chosen image; **"← חזרה ליצירה"**
  returns from the editor to the create screen.
- **Graphics made conservative** — only emit logo/qr/scale clusters (never a generic cluster), so a table's
  gridlines can't be rasterized into a black-looking grid.
- Gates: `verify:structured` now covers multi-sheet xlsx + template + interior colours. All 9 green.
- STILL DEFERRED: undo/redo; image flip/rotate; fewer-images-than-template proportioning; separating exterior
  vs interior PHOTO regions on import; per-brand logo asset library (awaiting the user's logo files).

## User-control + accuracy round (post-Milestone-D feedback)
- **Content-driven slot classification** (`templateLearning.slotKind`): each region is classified by its
  OWN text/shape, not just the page role — fixes "spec table → marketing-text" and "equipment list →
  colours". `classifyPage` also detects a spec page on a 16:9 deck (engine terms + many digits/units, not
  only the dense-grid rule). Verified on the RIFTER deck: colours page equipment → safety, spec page → spec-table.
- **Ignore a slot** (`SlotSpec.ignored`): excluded from generation (`generateCatalog`/`validateCatalog`/
  `dynamicSlots` skip it). Gate: `verify:gen` asserts an ignored slot's content is absent.
- **Editor object management** (`App`/`PageView`): DELETE (button + Delete/Backspace key, soft `deleted`
  flag, hidden in editor + skipped on export), MULTI-SELECT (shift/⌘/ctrl-click → `selectedIds` set, outlines
  all), and BULK delete. **Template review** (`TemplateScreen`): multi-select slots + bulk set-kind /
  dynamic-fixed / ignore / remove; per-slot ignore + remove.
- **Image dedupe** (`importPdf.dedupeImages`): pdf.js emits, for one SMasked picture, BOTH a transparent
  RGBA (→PNG) and an opaque RGB whose masked-out bg is BLACK (→JPEG); keeping the black one made black boxes
  around cut-out cars. Dedupe overlapping image ops, preferring the alpha PNG. Gate: `verify:images` asserts
  no two image blocks overlap >0.8 IoU. Pixel-confirmed on Berlingo (side-view cars, no black boxes).
- **Vector-graphics extraction** (`extractImages.walkPage` → `GraphicOp[]`, rasterized in `importPdf`):
  brand LOGOS (filled bezier curves), QR/barcodes (hundreds of tiny squares) and the colour SCALE bars of
  the pollution/safety-rating tables can't be rebuilt as primitives, so we cluster their "graphic ink"
  (small/curvy path boxes, not panels/gridlines) into regions, classify them (logo/qr/scale/graphic), and
  rasterize each from the page render to a sharp PNG (`renderPage.cropGraphic`). The whole region is baked
  (a scale keeps its white-on-colour numbers) and a scale's now-redundant text runs are dropped to avoid
  doubling. Browser-only (needs the page canvas); zIndex sits above photos, below text. Gate
  `npm run verify:graphics` asserts logo+QR+scale detection on the C5 Aircross. Region content
  pixel-confirmed (the safety 0–8 colour bar + arrow, the QR, the Citroën wordmark).

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
**MG**: Almoni Neue Bold (`src/assets/AlmoniNeue-Bold.otf`) — renders Hebrew + Latin + digits; only a BOLD
weight was supplied so it's used for both weights (add a regular if one arrives). MG is auto-detected by
filename (`detectBrand`/`importPdf`). Pixel-confirmed: MG_HS_PHEV exports in AlmoniTzar-Bold.
Peugeot OTF + **Citroën TTF (CitroenTypeHebrew Regular/Bold, +Light/Medium/ExtraLight)** are embedded
(`src/assets`, wired in `src/app/brandFont.ts`): applied in the editor and embedded on export per brand.
Pixel-confirmed: C5 Aircross exports in CitroenTypeHebrew-Bold. Other brands still fall back to a Hebrew
system stack until their font is supplied.

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
- ✅ ~~Text colour refinement (op-list) → real `tokens.accent`~~ — **done in Round 12** (exact per-run colour
  from the op-list, headless; `tokens.accent` is a real saturated colour).
- ✅ ~~Interior generated pages lack PHOTOS in a headless learn~~ — **done in Round 12** (learn gate imports via
  `@napi-rs/canvas`; learned template carries real image slots headlessly). The browser learn always had photos.
- Spec tables are positioned cells (grid reproduced visually); a real `TableBlockIR` + gridlines could come from
  source Excel (Milestone D) — largely addressed by Milestone D's `TableBlockIR`, kept here as the general note.

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
