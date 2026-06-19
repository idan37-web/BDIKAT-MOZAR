PROJECT: AutoSpec Studio — a catalog/PDF studio for automotive brochures (Hebrew, RTL).

CURRENT STATE: The app is a single 28MB HTML prototype (React + Babel in browser).
It is NOT a working tool. Diagnosis:
- No real PDF engine (no pdf.js / pdf-lib / getTextContent / jsPDF).
- PDF upload and template "learning" are simulated; preloaded IMPORT* objects are used as the source of truth.
- The editor renders a JPG of the page and overlays blocks on top. The original text is baked into the JPG.
- Text editing uses contentEditable inside a CSS transform:scale page -> unstable caret, broken line breaks.
- "Editing" hides baked-in text with a solid-color mask rect and draws new text over it -> fails over photos/gradients.
- Export is faked: a progress bar and a hardcoded "ready" message. No file is produced.

NON-NEGOTIABLE ARCHITECTURE DECISIONS:
1. Source of truth = a structured block model (IR), NOT the page raster. The original PDF render is a
   COMPARE/REFERENCE layer only — never a layer we edit on top of.
2. The solid-color mask + redraw approach is a BOUNDED FALLBACK only, used solely for heavily designed
   external PDFs where clean extraction fails. It is NOT the default editing model.
3. Hebrew is handled explicitly. pdf-lib does NO bidi/shaping. Reorder logical->visual before drawing.
4. Text editing = an absolutely positioned <textarea> overlay in SCREEN coordinates, outside the scaled
   page transform. One coordinate-transform utility maps PDF points <-> screen px. Do NOT use
   contentEditable inside the scaled page.
5. Text rendering = DOM/HTML (browser RTL engine). Do NOT use canvas/Konva for text. Canvas is allowed
   only for image frames/drag if needed.
6. Real vector export via pdf-lib + @pdf-lib/fontkit with embedded Hebrew fonts. NEVER rasterize a page
   and call it a PDF export.
7. Drop the single-file constraint for heavy work: Vite + ES modules + TypeScript.

HARD "DO NOT" LIST:
- Do NOT simulate work with setTimeout progress bars.
- Do NOT paint solid-color masks over photos to "cover" text in the default path.
- Do NOT use fontFamily:inherit for imported text.
- Do NOT rasterize a page and call it PDF export.
- Do NOT keep IMPORT3008 / IMPORTC3 as the source of truth (demo fixtures only).
- Do NOT polish the UI before the PDF engine works end to end.
- Do NOT patch the old raster approach — build on the structured model.

START HERE to continue work: docs/PROGRESS.md (what's done, gotchas, how to continue).
Full staged plan and prompts: docs/AutoSpec-directive.md · Domain findings + IR + roadmap: docs/AutoSpec-brief.md
