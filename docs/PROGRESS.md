# AutoSpec Studio — Progress & Handoff (continue here)

> Read order for a fresh session: `CLAUDE.md` (non-negotiables) → `docs/AutoSpec-directive.md`
> (the staged plan C.0–C.9, source of truth) → this file (what's done, gotchas, how to continue).
> Domain facts: `docs/AutoSpec-brief.md`. Hebrew, RTL throughout.

## TL;DR
We executed the directive in order. **All stages 0–7 are done and verified.** The full pipeline works:
**learn a TemplateSpec from same-family PDFs → generate a catalog DocumentIR from slot bindings → edit it in
the IR editor → export a real vector Hebrew PDF**, alongside the original **import an external PDF → IR → edit →
export** path. No simulated steps anywhere. Next work is hardening/polish (see "Open follow-ups").

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

## Open follow-ups (not blockers)
- Text colour refinement (op-list) → real `tokens.accent` per model (currently placeholder `#111418`).
- Generated image slots are placeholders until bound; consider learning real hero-image bboxes from the
  browser import (image blocks) so generated covers carry a frame even before the user uploads.
- Spec tables generate as one text block (per directive); a real `TableBlockIR` path could come from source Excel.

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
