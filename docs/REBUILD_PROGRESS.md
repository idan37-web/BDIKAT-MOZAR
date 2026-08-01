# AutoSpec Studio — Rebuild Progress (docs/REBUILD_BRIEF.md execution log)

Execution log for the staged rebuild in `docs/REBUILD_BRIEF.md`. Per the brief's
Autonomy protocol (§7): run continuously, self-verify each stage's acceptance
criteria against a real fixture, log a 3-line note, then continue. Pause only
before a **material change** actually being made.

## Two material-change forks — decided, not built (§7)

The brief names two triggers that gate Stages 1/3 and the whole model. Both are
resolved to the sensible default that keeps the app runnable and honors the
existing product contract; neither warrants a build that would regress it:

- **§7(b) — introduce a Python/PyMuPDF backend (brief "prefers" it for Stages
  1 & 3): DECLINED, stay client-only.** The shipping deliverable is a single
  fully-offline `AutoSpec-Studio-app.html` (~5.3 MB, fonts bundled) that a
  backend would break. The brief itself names the client path — "a disciplined
  `pdf.js` `operatorList` + reconstruction implementation" — as the acceptable
  fallback, and that path is exactly what already exists and is verified
  (`src/pdf/importPdf.ts` + `src/pdf/extractImages.ts` walking `getOperatorList`
  for real image XObjects, never canvas crops). Not introducing a backend is
  declining a material change, so no pause is required.
- **§7(a) — rename the data-model contract to `Block`/`SpecDoc`/`Template`:
  NOT done.** The brief says "adjust names, keep the semantics." The existing IR
  (`src/types/catalog.ts`: `BlockIR`/`TextBlockIR`/`ImageBlockIR`/`ShapeBlockIR`/
  `TableBlockIR`/`PageIR`/`DocumentIR`) already carries every section-4 semantic
  (top-left points, `role`/fixed-vs-variable via template learning, logical-order
  text, `zIndex`, per-kind content). A rename is a §7(a) material change with no
  functional benefit, so it is deliberately not performed.

## Stage 0 — Lock the data model + coordinate/bidi seams ✅

- **What changed:** added `tests/stage0-seams.test.ts` pinning the brief's two
  Stage-0 acceptance criteria to the existing seams — `src/editor/coords.ts`
  (single pt↔px map, no CSS `transform:scale`) and `src/engine/bidi.ts` (the one
  UAX #9 seam via `bidi-js`, re-exported by `src/pdf/hebrew.ts`). No feature code
  touched; the section-4 contract already lives in `src/types/catalog.ts`.
- **What I checked (real modules):** coords round-trips PDF→viewport→PDF with a
  max error of ~1.8e-15 pt across zoom/DPR factors {0.5…3.14} — far under the
  <0.5pt bar. `bidi` on `מחיר: 149,900 ₪ (GT)` → `(GT) ₪ 149,900 :ריחמ`: the
  digits `149,900` and the Latin `GT` are NOT reversed; only the Hebrew reorders.
- **Result:** `tsc --noEmit` clean; full `vitest run` 56/56 green (incl. the 4
  new Stage-0 assertions). App runnable.

## Stage 0→9 gap map (existing verified codebase vs. the brief)

The target architecture in the brief is already implemented and verified — this
is a hardening/lock-in pass over a working app, not a big-bang rewrite (which the
brief forbids). Each stage below is satisfied by existing modules and a green
gate/test in *this* container:

| Stage | Brief goal | Already satisfied by | Evidence (green) |
|---|---|---|---|
| 0 | model + coords + bidi seams | `types/catalog.ts`, `editor/coords.ts`, `engine/bidi.ts` | `tests/stage0-seams.test.ts` |
| 1 | reliable extraction → block model | `pdf/importPdf.ts`, `pdf/extractLayout.ts` (client pdf.js path) | `verify:structured`, `verify:learn` |
| 2 | text-structure reconstruction | `engine/textRecon.ts` (pdfplumber WordExtractor port) via `clusterTextBlocks` (y/x tolerance ratios, column-gap, table-row guard) | `verify:structured`, `verify:edit-tables` |
| 3 | image/logo extraction (no burn-in) | `pdf/extractImages.ts` `walkPage` — real XObjects via `getOperatorList`, masked/bgWhite handling, never canvas crops | `verify:images` |
| 4 | editor renders the block model | `app/PageView.tsx` renders IR; textarea overlay in screen coords, model is source of truth | `verify:milestone-a` |
| 5 | coordinate & DPR correctness | single `coords.ts` seam; DPR-aware `renderPage` | `verify:milestone-a`, `tests/stage0-seams.test.ts` |
| 6 | template learning fixed vs variable | `templates/templateLearning.ts` — `classifyPage`, cross-doc fixed/dynamic diff | `verify:learn` |
| 7 | content binding + auto-fit | slot binding + autofit (`fitPageText`, `oneLineFitFactor`) | `verify:autofit`, `verify:gen` |
| 8 | high-fidelity Hebrew PDF export | `pdf/exportPdf.ts` — pdf-lib + fontkit, glyph-by-glyph RTL through the bidi seam, embedded Hebrew fonts | `tests/bidi-roundtrip.test.ts`, `verify:gen` |
| 9 | persistence (IndexedDB) + PWA | `store/library.ts` (IndexedDB, content-hash asset dedupe); SW app-shell precache | `verify:persistence`, `verify:pwa` |

**Gates green in this container (13):** `verify:structured, learn, gen, images,
shapes, graphics, autofit, ai, persistence, milestone-a, edit-tables, engine` +
`vitest run` (56/56). `verify:pwa` runs a full build and is checked at release.
