# AutoSpec Studio — Unified Brief

> The single source of truth for the rebuild. Unifies (a) the **domain knowledge measured from the
> real client PDFs** (carry this forward — it is real and expensive to re-derive) with (b) the
> **target architecture, full IR, and the staged build plan** referenced from the root `CLAUDE.md`.
> Hebrew, RTL throughout. Read `CLAUDE.md` first for the non-negotiables; this expands them.

---

## 1. Product

A tool for a vehicle importer to produce **brand-consistent vehicle spec brochures/catalogs** ready for
distribution as **high-quality PDF**. Pipeline: ingest raw materials (images, marketing copy, technical
tables, colors, wheels, safety/pollution data) → place them into a **brand template** → edit visually →
**export a real, print-quality, RTL Hebrew PDF**.

Core principles (unchanged from day one):
- **Separation of content · design · template.** A template is a list of **slots + style tokens +
  data schema**, never a picture of a page.
- **Multi-brand, multi-template.** Never single-model. Brands: **Peugeot · Citroën · Opel · DS · IM · MG**.
- **Hebrew + full RTL is mandatory.** **PDF output is the real deliverable.** **Manual editing before
  export is mandatory.** Template learning from an existing PDF must be possible.
- Legal: internal importer tool. Brand names are data; do **not** reconstruct proprietary logos/UI —
  letter-badge placeholders only.

---

## 2. Current state & why we are rebuilding

The shipped artifact (`project/AutoSpec-Studio.html` and the `project/*.jsx` sources) is a **design
prototype**: React + Babel-in-browser, original page text **baked into a JPG**, editable blocks
overlaid on top, `contentEditable` inside a `transform:scale` page, and a **faked** export progress bar
that produces no file. It proved the UX and the domain analysis, but it is **not a working tool** and
its raster-overlay editing model is a dead end for real text editing/export.

The rebuild keeps the **domain findings and the UX intent**, and replaces the engine:
**structured IR as source of truth + real extraction + real vector PDF export.** Treat the prototype as
**reference/fixtures only** (`IMPORT3008`, `IMPORTC3`, `import_library.js`, `analysis/previews/*` are
demo fixtures, not the source of truth).

---

## 3. Measured domain findings (carry forward — verified from the real PDFs)

Extraction was done with PyMuPDF over the client's actual catalogs. These numbers are measured, not guessed.

**Formats are NOT uniform even within one brand → automatic format detection + multiple templates per brand.**

| Brand | Category | Files (in `uploads/`) | Page format (pt) | Pages | Good diff pair |
|---|---|---|---|---|---|
| Citroën | Commercial | Berlingo, Jumpy¹ | 595² cover / 1191×595 spread | 12, 8 | Berlingo ↔ Jumpy |
| Citroën | Passenger | C3 Aircross | 595² / 1191×595 | 14 | |
| Citroën | Passenger (wide) | C5 Aircross | 709² / 1417×595 | 15 | |
| Citroën | **Digital 16:9** | C3 | **1920×1080** | 15 | (deck, not A4) |
| Peugeot | Passenger | 208 | 1191×595 spread | 12 | |
| Peugeot | Passenger | **3008, 5008** | 1191×595 spread | 19, 19 | 3008 ↔ 5008 (near-identical) |
| Peugeot | MPV (tall) | Rifter | 1191×670 | 8 | |
| Peugeot | Commercial | Boxer¹ | 581² / 1162×581 | 5 | |

¹ Berlingo/Jumpy/Boxer PDFs were analyzed earlier but are **not currently in `uploads/`** — request them to extend coverage.

- **Spreads:** print catalogs are built as **two-page spreads** (square cover ≈595×595pt + 1191×595 spreads). One catalog (Citroën C3) is a **16:9 on-screen deck**, not print.
- **Typography (measured):** section heading ~21–25pt · body 11–15pt · table 8–9pt · hero/giant number 45–85pt · RTL.
- **Citroën commercial palette (extracted):** text `#101114` · gray panel `#D8D8D5` · green accent `#00AB54`. Insight: structure + neutrals are fixed, but the **accent color is per-model** (Berlingo `#00ACBA`, Jumpy `#4559A2`, C3 `#EE726C`…) → a dynamic brand token `brand.accent`.
- **Spec tables are "positioned text," not real tables:** a grid of ~22 columns (label + a value column per trim) × ~38–40 rows. Reconstruct columns by clustering on X/Y; **prefer the source Excel/CSV when available.**
- **Hebrew text order:** PyMuPDF returns text in **LOGICAL order — do NOT reverse it.** (Reversing was a real bug.) Reorder logical→visual only at the pdf-lib draw step on export.

### 3.1 Extraction risks (we hit all of these — the manual-correction stage is mandatory)
1. Hebrew/RTL bidi — keep logical order in the IR; reorder only for raster export.
2. Tables are floating positioned text — column rebuild is fragile; prefer source spreadsheets.
3. Mixed formats (print spread vs 16:9 deck) — detect format per file.
4. Fonts arrive as anonymous subsets (`g_d0_f1…`) — need the real font files for embedding.
5. Images rasterized/flattened (cover = single bitmap) — need source images for true re-use.
6. RGB only — complete CMYK/Pantone from the brand guide.

### 3.2 Assets present in the repo
- `uploads/PEUGEOT/PRIVATE/` → 208, 3008, 5008, RIFTER `.pdf`; `uploads/CITROEN/PRIVATE/` → C3, C3 Aircross, C5 aircross `.pdf`.
- `fonts/PeugeotNewHebrew-*.otf` — real Peugeot Hebrew font (embed it). **Citroën font was never supplied** → request `CitroenType`/`CitroenTypeHebrew` OTF; until then Citroën falls back to a Hebrew system stack (Assistant/Heebo), never Peugeot.
- `analysis/previews/*.jpg` — faithful page renders (the COMPARE/reference layer).
- `logos/*.png` — letter-badge placeholders.

---

## 4. Target architecture (expands `CLAUDE.md` — non-negotiable)

- **Source of truth = the IR** (structured block model). The original PDF render is a
  **compare/reference layer only**, never something we edit on top of.
- **Extraction pipeline** (pdfjs-dist in app / PyMuPDF at build) turns external PDFs into IR, Hebrew in
  **logical order**, coordinates in **PDF points**.
- **Solid-color mask + redraw is a BOUNDED FALLBACK** for heavily-designed pages where clean extraction
  fails — not the default editing path, and never painted over photos by default.
- **Text editing = an absolutely-positioned `<textarea>` overlay in SCREEN coordinates**, mounted
  *outside* the scaled page transform. One utility maps PDF points ↔ screen px (page scale + offset).
  **No `contentEditable` inside the scaled page.**
- **Text rendering = DOM/HTML** (let the browser's RTL engine do bidi/shaping). No canvas/Konva for text.
- **Export = real vector PDF** via `pdf-lib` + `@pdf-lib/fontkit`, embedding the Hebrew fonts. pdf-lib
  does **no** bidi/shaping → reorder logical→visual (bidi-js) before drawing each run.
- **Build = Vite + ES modules + TypeScript.** No Babel-in-browser.

### Stack
`pdfjs-dist` (render + extract) · `pdf-lib` + `@pdf-lib/fontkit` (vector export) · `bidi-js` (Hebrew
reorder for export) · `PyMuPDF` (server/build extraction) · `Vite` + `TypeScript`.

### Coordinate convention (fixes a prototype mistake)
Store all geometry as **top-left origin, +x right, +y down, in PDF points**. RTL is a **text property**
(`direction`/`align`), **not** a coordinate hack. The prototype's "x = distance from right" must not
survive into the IR. A single `pointsToScreen(pt, pageScale, pageOffset)` / `screenToPoints(...)` pair
is the only place scale lives.

---

## 5. The IR — full field list (`src/types/catalog.ts`)

```ts
type ID = string;
type Hex = string;                         // "#rrggbb"
type Dir = 'rtl' | 'ltr' | 'auto';
type Align = 'start' | 'center' | 'end' | 'justify';
type Fit = 'contain' | 'cover' | 'fill';

interface DocumentIR {
  id: ID;
  title: string;
  sourcePdf?: string;                      // original filename (fixtures/reference only)
  brand: string;                           // 'peugeot' | 'citroen' | 'opel' | 'ds' | 'im' | 'mg'
  brandFont: FontRef;                      // resolved per brand; never inherit
  format: 'print-spread' | 'deck-16x9' | 'a4' | string;  // auto-detected
  pages: PageIR[];
  createdAt: string;
  meta?: Record<string, unknown>;
}

interface PageIR {
  id: ID;
  index: number;                           // 0-based order
  sourcePageNumber?: number;               // 1-based in the source PDF
  widthPt: number;                         // PDF points
  heightPt: number;
  bg: Hex;
  kind: 'cover' | 'content' | 'spec' | 'colors' | 'wheels' | 'safety' | 'pollution' | 'back' | 'blank';
  referenceRaster?: string;                // path/data-URI of the faithful render (compare layer)
  blocks: BlockIR[];
  warnings: ImportWarning[];               // QA: overlaps, overflow, low-confidence, missing src…
}

// base — all coords top-left origin, PDF points
interface BlockBase {
  id: ID;
  type: 'text' | 'image' | 'shape' | 'table';
  x: number; y: number; w: number; h: number;
  z: number;                               // draw/stack order (deterministic)
  sourcePageNumber?: number;
  originalBBox?: { x: number; y: number; w: number; h: number };  // for compare/diff + revert
  confidence?: number;                     // 0..1 extraction confidence
  locked?: boolean;
}

interface TextBlockIR extends BlockBase {
  type: 'text';
  role: 'heading' | 'subheading' | 'paragraph' | 'eyebrow' | 'legal' | 'footer' | 'cell';
  text: string;                            // LOGICAL order
  originalText: string;                    // as-extracted, for "modified" detection / revert
  font: FontRef;                           // explicit; never inherit for imported text
  size: number;                            // pt
  weight: number;                          // 100..900
  color: Hex;
  direction: Dir;
  align: Align;
  lineHeight: number;
  letterSpacing?: number;
  lines?: { text: string; spans?: { text: string; font?: FontRef; color?: Hex }[] }[];
  maskColor?: Hex;                         // sampled local bg, only for the bounded fallback
}

interface ImageBlockIR extends BlockBase {
  type: 'image';
  src: string;                             // source image (preferred) …
  crop?: { fx: number; fy: number; fw: number; fh: number };  // … or a crop of referenceRaster (fallback)
  cropFromReference?: boolean;
  fit: Fit;                                // default 'contain'; full-bleed = 'cover'
  naturalW?: number; naturalH?: number;
  alt?: string;
}

interface ShapeBlockIR extends BlockBase {  // background panels / strips / rules
  type: 'shape';
  fill?: Hex;
  stroke?: { color: Hex; width: number };
  radius?: number;
}

interface TableBlockIR extends BlockBase {  // when a real table can be recovered (or from Excel/CSV)
  type: 'table';
  rows: number; cols: number;
  cells: { r: number; c: number; rowSpan?: number; colSpan?: number; block: TextBlockIR }[];
  columnGutterPt?: number;                 // spec pages often hold TWO tables with a center gutter
}

interface FontRef { family: string; file?: string; weight?: number; style?: 'normal' | 'italic'; }
interface ImportWarning { level: 'info' | 'warn' | 'error'; code: string; blockId?: ID; msg: string; }
```

Notes:
- A **Template** is derived from the IR: `Slot { id, kind, sourceSchema, dynamic, bbox, style }` over a
  **fixed skeleton** (`logo`, `section_header`, `grid`, `legal_footer`). Content/design/data stay separated.
- `maskColor` and `crop-from-reference` exist **only** to support the bounded fallback; the default path
  uses real `src` images and real text.

---

## 6. Editing model (the part the prototype got wrong)

- The page renders from the **IR as DOM** (real elements). The reference raster sits **behind** in
  Compare/Original views; it is never the thing you edit.
- Selecting a text block and editing mounts a **`<textarea>` in screen coordinates** sized/positioned via
  `pointsToScreen`, with the block's font/size/weight/color, `dir`, wrapping within the block width and
  growing in height. Commit writes back to `TextBlockIR.text`. Because it is real HTML text, RTL/bidi and
  wrapping are correct and nothing "becomes one long line."
- View modes for imported pages: **Original** (reference raster only) · **Editable** (IR on page) ·
  **Compare** (IR over reference with diff/opacity). No baked-text overlay.

---

## 7. Staged build plan (each stage ships a real, openable artifact + acceptance test)

> Proposed roadmap consistent with `CLAUDE.md`. Adjust freely — but **Stage 0 is a hard gate.**

- **STAGE 0 — pdf-lib Hebrew gate (BLOCKER).** Produce a `.pdf` containing a mixed string
  `"מנוע 1.2 PureTech ט/ק 130"` with an embedded Hebrew font.
  *Accept:* opens in a viewer, text is **selectable**, characters in **correct visual order**. If this
  fails, stop — nothing else matters.
- **STAGE 1 — scaffold + IR.** Vite + TS project, `src/types/catalog.ts`, `pointsToScreen/screenToPoints`.
  *Accept:* `tsc` clean; a hand-written `DocumentIR` renders to a DOM page at correct scale.
- **STAGE 2 — extraction → IR.** PyMuPDF (build) + pdfjs (app) turn a real PDF (start: Peugeot 3008) into
  `DocumentIR`, Hebrew logical, points coords, text/image/shape blocks, per-page `referenceRaster`.
  *Accept:* IR JSON validates; block count/positions sane; no reversed Hebrew.
- **STAGE 3 — render + compare.** Read-only IR→DOM render; Original/Editable/Compare modes against the
  reference raster. *Accept:* Editable view visually matches Original within tolerance on 3008 content pages.
- **STAGE 4 — text editing.** `<textarea>` screen-overlay editing; wrap-in-box, grow-down, RTL preserved,
  commit to IR, undo/redo. *Accept:* edit a Hebrew paragraph and a mixed-script cell — no overflow, no
  alignment loss, styling preserved.
- **STAGE 5 — images + fallback.** Image blocks with `fit`/`crop`; bounded mask+redraw fallback flagged
  per-page. *Accept:* move/replace an image; fallback only triggers where extraction confidence is low.
- **STAGE 6 — vector export.** `pdf-lib` + `fontkit` + `bidi-js`; embed Hebrew fonts; reorder logical→visual.
  *Accept:* export the edited 3008 → real multi-page PDF, selectable correct-order Hebrew, images vector-placed.
- **STAGE 7 — product surface.** Dashboard, brand/template management, New-Spec wizard that emits a real IR,
  template learning (extract → review/correct slots → save) → opens in the editor. *Accept:* end-to-end
  brand→template→materials→edit→export with no simulated steps.

---

## 8. DO NOT
- Do NOT simulate work with `setTimeout` progress bars.
- Do NOT paint solid-color masks over photos to "cover" text in the default editing path.
- Do NOT use `fontFamily: inherit` for imported text.
- Do NOT rasterize a page and call it a PDF export.
- Do NOT keep `IMPORT3008` / `IMPORTC3` (or `import_library.js`) as the source of truth — demo fixtures only.
- Do NOT patch the old raster approach — build on the structured model.
- Do NOT reverse Hebrew at extraction — PyMuPDF/pdfjs already yield logical order.

---

## 9. References
- Root non-negotiables: `CLAUDE.md`.
- Prototype sources (reference/fixtures): `project/*.jsx`, `project/import_*.js`, `project/AutoSpec-Studio.html`.
- Prototype memory (rich prototype-era notes): `project/CLAUDE.md`.
- History of the prototype line of work: `chats/` and `CHANGELOG_FOR_CLAUDE_CODE` (handoff).
- Real inputs: `uploads/**/*.pdf`, `fonts/*.otf`, `analysis/previews/*.jpg`, `logos/*.png`.
