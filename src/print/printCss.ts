// Print stylesheet + standalone HTML shell for the HTML-print export pilot.
// @page size matches the template page size in PDF POINTS (margin 0 — the template owns its
// own margins), colors print exactly, and each .print-page breaks to its own sheet.

/** The dedicated print stylesheet. `w`/`h` are the template page size in PDF points. */
export function printCss(w: number, h: number): string {
  return `
@page { size: ${w}pt ${h}pt; margin: 0; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.print-page { page-break-after: always; break-after: page; }
.print-page:last-child { page-break-after: auto; break-after: auto; }
img { user-select: none; }
@media print { .no-print { display: none !important; } }
@media screen { body { background: #555; } .print-page { margin: 12px auto; box-shadow: 0 6px 24px rgba(0,0,0,.4); } }
`;
}

export interface PrintFont { family: string; regularB64: string; boldB64?: string; format?: string }

/** @font-face rules embedding the brand font as base64 (self-contained HTML — no fetches). */
export function fontFaceCss(f: PrintFont): string {
  const fmt = f.format || 'opentype';
  let css = `@font-face{font-family:'${f.family}';src:url(data:font/otf;base64,${f.regularB64}) format('${fmt}');font-weight:400;}`;
  if (f.boldB64) css += `\n@font-face{font-family:'${f.family}';src:url(data:font/otf;base64,${f.boldB64}) format('${fmt}');font-weight:700;}`;
  return css;
}

/** Wrap rendered PrintView markup in a complete standalone HTML document. */
export function printHtmlShell(markup: string, pageW: number, pageH: number, fonts: PrintFont[]): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>AutoSpec print</title>
<style>${fonts.map(fontFaceCss).join('\n')}</style>
<style>${printCss(pageW, pageH)}</style>
</head>
<body>${markup}</body>
</html>`;
}
