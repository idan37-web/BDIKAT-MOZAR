# AutoSpec Studio — מסמך הנחיה מאוחד ל-Claude Code

מסמך זה ממזג את שתי חוות הדעת על האפליקציה לכדי תוכנית עבודה אחת.
החלק ההסברי וההכרעות בעברית. ההנחיות להדבקה ל-Claude Code באנגלית (סעיף C).
מומלץ להניח אותו בשורש הריפו כקובץ הקשר.

---

## חלק א — אבחון מאוחד (שתי חוות הדעת מסכימות)

האפליקציה היא קובץ HTML יחיד (~28MB) עם React ו-Babel שרצים בדפדפן, נתונים מוטמעים מראש ותמונות base64.
היא אב-טיפוס עיצובי, לא אפליקציה עובדת.

- **אין מנוע PDF אמיתי.** אין שימוש ב-pdf.js, pdf-lib, getTextContent, getOperatorList או jsPDF.
- **ההעלאה והסריקה מדומות.** "העלאת PDF" בוחרת נתונים שהוכנו מראש (IMPORT3008 וכו') ומריצה אנימציית `setTimeout`.
- **העורך הוא שכבת בלוקים מעל תמונת JPG של העמוד.** הטקסט המקורי צרוב בפיקסלים.
- **עריכת טקסט בנויה על `contentEditable` בתוך עמוד שעבר `transform: scale`.** זה גורם למיקום סמן לא מדויק, שבירת שורות לא צפויה, וקפיצות טקסט. זו בעיה נפרדת מבעיית הראסטר.
- **גישת מסכה בצבע אחיד (`maskColor`)** מכסה את הטקסט הצרוב ומציירת טקסט חדש מעל. נכשלת מעל רקע לא אחיד (תמונה/גרדיאנט/פס).
- **הייצוא מזויף לחלוטין.** מד התקדמות והודעת "מוכן" קבועה בקוד. שום קובץ לא נוצר.

---

## חלק ב — ההכרעות הארכיטקטוניות

> בשני מקומות שתי חוות הדעת נחלקו. ההכרעה כאן היא הגישה המומלצת.

1. **מקור האמת = מודל בלוקים מובנה (IR), לא תמונת ה-JPG.**
   העריכה על טקסט אמיתי. תמונת ה-PDF המקורי יורדת לשכבת **השוואה/דיבוג בלבד**, לעולם לא שכבה שעורכים מעליה.

2. **גישת המסכה = נפילה אחורה מתוחמת בלבד.**
   (הכרעה מול חוות הדעת המצורפת, שהציעה אותה כמודל עריכה ראשי.)
   מותר להשתמש במסכה + ציור מחדש רק ל-PDF חיצוני מעוצב בכבדות שאי אפשר לחלץ ממנו מודל נקי. לא כמודל ברירת המחדל.

3. **שלב אפס חוסם: עברית דרך pdf-lib.**
   pdf-lib לא עושה bidi/shaping. מחרוזת עברית לוגית תצויר הפוך/משובש בלי טיפול.
   חייבים להוכיח round-trip של עברית מעורבת לפני שבונים שום דבר אחר. זו נקודת הכשל הסמויה של כל התוכנית.

4. **עורך טקסט: textarea overlay בקואורדינטות מסך, לא contentEditable בתוך scale.**
   (תיקון נכון מחוות הדעת המצורפת.) פונקציית המרת קואורדינטות אחת בין נקודות PDF למסך.

5. **טקסט = DOM/HTML, לא Konva.**
   (הכרעה מול ההצעה ל-react-konva.) מנוע הטקסט של הדפדפן נותן RTL עברי טוב בהרבה מקנבס. Konva, אם בכלל, רק למסגרות תמונה וגרירה.

6. **ייצוא וקטורי אמיתי.** pdf-lib + @pdf-lib/fontkit, פונט עברי מוטמע. אסור לרנדר עמוד לתמונה ולקרוא לזה ייצוא.

7. **לזנוח את הקובץ היחיד.** מעבר ל-Vite + מודולים + TypeScript עבור החלקים הכבדים.

8. **אופציה אסטרטגית: SDK מסחרי.**
   (תוספת טובה מחוות הדעת המצורפת.) אם רוצים עריכת טקסט אמיתית בתוך PDF חיצוני בלי לבנות צינור חילוץ, Apryse WebViewer או Nutrient נותנים WYSIWYG מובנה. הסתייגות: בתשלום, יקרים, וכבדים. אופציה, לא ברירת מחדל.

**תיחום ציפיות:** לקטלוגים שהמערכת מייצרת, עריכה מלאה אפשרית (אתה בעל המבנה). ל-PDF חיצוני מעוצב, לתחום ל"החלף טקסט בתיבה, הזז, צבע, הוסף/הסר", לא שחזור פיקסל מושלם.

---

## חלק ג — הנחיות ל-Claude Code (להדבקה לפי הסדר)

### C.0 — Repo context (paste once as CLAUDE.md)

```text
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
```

### C.1 — Internal data model (IR)

```text
Define these types in src/types/catalog.ts:

DocumentIR { id, sourcePdfName, pages: PageIR[] }

PageIR {
  id, width, height, rotation,
  previewImage,            // reference only, for Compare mode
  originalPdfPageIndex,
  blocks: BlockIR[]
}

BlockIR {
  id, type: 'text'|'image'|'shape'|'table'|'logo'|'slot'|'background',
  x, y, width, height, rotation, zIndex,
  source: 'original'|'generated'|'user',
  locked, originalBBox, dirty, deleted
}

TextBlockIR extends BlockIR {
  text, originalText, fontFamily, embeddedFontRef, fontSize, fontWeight,
  lineHeight, letterSpacing, color,
  direction: 'rtl'|'ltr'|'mixed', align, lines: string[]
}

ImageBlockIR extends BlockIR {
  src, originalImageRef, fit: 'cover'|'contain', crop, mask
}

Coordinates are stored in PDF points. All scaling happens at render time only.
```

### C.2 — STAGE 0 (gate): prove Hebrew round-trips through pdf-lib

```text
Create a minimal standalone Vite + TypeScript project.
Using pdf-lib and @pdf-lib/fontkit:
- Embed a Hebrew-capable font.
- Produce a one-page PDF containing the mixed string: פיג'ו 3008 EV · 130 כ"ס · 1.2L
- Handle bidi so the visual order is correct (reorder logical->visual before drawing; use bidi-js if helpful).
DO NOT proceed to any other stage until I confirm: the file opens, the text is selectable and copyable,
and the order of Hebrew + digits + Latin is correct. This is the gate for the whole project.
```

### C.3 — STAGE 1: real build

```text
Refactor the single HTML prototype into a Vite + TypeScript + React app.
- Move the heavy embedded data (IMPORT_*, __RESMAP) out of HTML into separate data files loaded on demand.
- Remove Babel-in-browser.
- Keep the existing visual design.
Acceptance: `npm run build` works, the app loads visually identical, no in-browser transpilation.
```

### C.4 — STAGE 2: real PDF import

```text
Implement real import in src/pdf/importPdf.ts + extractLayout.ts + renderPage.ts:
- Real file input + drag/drop reading the PDF as ArrayBuffer.
- Load with pdfjs-dist.
- Per page: read size+rotation from viewport; render a >=2x preview; extract text items with coordinates,
  font size, transform matrix and direction; group items into lines/paragraphs; store as PageIR in PDF points.
- IMPORT3008/IMPORTC3 become demo fixtures only, never the source of truth after an upload.
Acceptance: dragging a NEW PDF imports THAT pdf; first page renders; text is selectable. No hardcoded PDF used.
```

### C.5 — STAGE 3: structured model as truth + stable text editor

```text
Make the block model the source of truth for editing. Drop the page raster to a Compare-only layer.
Remove all maskColor/SmartMask logic from the DEFAULT editing path (keep a separate bounded fallback module
for external heavily-designed pages only).
Implement text editing in src/editor/TextEditOverlay.tsx:
- Double-click a text block opens an absolutely positioned <textarea> in SCREEN coordinates (outside the
  scaled page transform), using one PDF-point<->screen-px utility.
- Live update while typing; on commit set dirty=true.
- Correct RTL and mixed Hebrew/English; preserve line breaks; controls for font size, width, height, align.
- Text must not escape its box unless the box is resized; show an overflow warning when it does not fit.
FORBIDDEN: fontFamily:inherit for text, solid-color masks in the default path, reflow that moves the block.
Acceptance: editing a Hebrew heading stays in place, in the right font, with no background patch and no
duplicated text. Add a view toggle: Original / Editable / Reconstructed / Compare.
```

### C.6 — STAGE 4: real vector export

```text
Implement src/pdf/exportPdf.ts:
- Walk the PageIR and draw to a vector PDF with pdf-lib + @pdf-lib/fontkit (text, panels, images).
- Embed Hebrew fonts; apply the bidi reordering proven in Stage 0.
- For edited external PDFs: load the original with pdf-lib, draw mask/delete rects for changed blocks, draw
  edited content on top (this is the bounded fallback). For generated catalogs: full vector from IR.
- RGB digital export first. Real file download. Remove the fake progress flow.
Acceptance: the exported PDF visually matches the editor; text is vector and selectable; Hebrew order correct.
Add a visual regression check: render original vs edited export and diff.
```

### C.7 — STAGE 5: image editing

```text
- Make extracted/inferred images selectable.
- Replace an image from uploaded assets while preserving the original bounding box.
- Support cover/contain, crop, reposition, scale-in-frame; never stretch car images by default.
- Add "fit to frame", "fill frame", "reset crop".
```

### C.8 — STAGE 6: real template learning

```text
Replace the simulated learning with real logic in src/templates/templateLearning.ts:
- Learn from one or more PDFs of the same brand/template.
- Detect repeated page roles (cover, feature spread, interior/design, colors, wheels, safety/spec table,
  price/legal/back).
- Detect slots (fixed brand elements; dynamic model name, hero image, text, technical table, colors, wheels,
  safety/pollution table).
- Compare multiple same-family PDFs to decide fixed vs dynamic regions.
- Save TemplateSpec as JSON. The user must be able to correct slots manually.
```

### C.9 — STAGE 7: catalog generation

```text
Build generation from TemplateSpec (src/catalog/generateCatalog.ts), not hardcoded pages:
- User uploads assets and maps them to slots; validate missing required assets.
- Generate PageIR pages from the template; open the result in the same editor.
- Remove ALL simulated generation/scanning steps. Every action must produce a real artifact.
```

---

## חלק ד — קריטריוני קבלה כוללים (אל תשחרר אם אחד מהם נכשל)

- גרירת PDF חדש באמת מייבאת אותו; אין שימוש ב-PDF קבוע בקוד אחרי העלאה.
- אפשר לבחור טקסט מעמוד PDF מיובא.
- דאבל-קליק פותח עורך טקסט יציב; עברית נערכת נכון; עברית+אנגלית מעורבת לא מתהפכת.
- טקסט נשאר בתוך התיבה אלא אם משנים גודל; הזזה/שינוי גודל לא יוצרים טקסט כפול.
- החלפת תמונה שומרת מסגרת ובקרות crop.
- הייצוא מוריד PDF אמיתי שתואם ויזואלית לעורך, עם טקסט וקטורי ועברית בסדר נכון.
