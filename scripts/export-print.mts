// Local HTML-print export CLI (pilot): import a source PDF (or run on a stored doc) and export
// it through the flagged exporter. The Block IR remains the source of truth; the HTML view is
// derived at export time and never stored.
//
//   npx tsx scripts/export-print.mts <input.pdf> <output.pdf> [pdf-lib|html-print]
//
import { readFileSync, writeFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { exportDocument, type ExporterKind } from '../src/print/exporters';
import { detectBrand } from '../src/app/brandFont';

const BRAND_ASSETS: Record<string, { regular: string; bold?: string }> = {
  peugeot: { regular: 'src/assets/PeugeotNewHebrew-Regular.otf', bold: 'src/assets/PeugeotNewHebrew-Bold.otf' },
  citroen: { regular: 'src/assets/CitroenTypeHebrew-Regular.ttf', bold: 'src/assets/CitroenTypeHebrew-Bold.ttf' },
  opel: { regular: 'src/assets/OpelNextHebrew-Regular.otf', bold: 'src/assets/OpelNextHebrew-Bold.otf' },
  mg: { regular: 'src/assets/AlmoniNeue-Bold.otf' },
};

const [input, output, kindArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: npx tsx scripts/export-print.mts <input.pdf> <output.pdf> [pdf-lib|html-print]');
  process.exit(2);
}
const kind = (kindArg || 'html-print') as ExporterKind;

const b = readFileSync(input);
const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), input.split('/').pop()!, {
  renderPreviews: false, reconstructTables: true,
});
const brand = doc.brand || detectBrand(input);
const assets = BRAND_ASSETS[brand] || BRAND_ASSETS.peugeot;
const fonts = {
  regular: new Uint8Array(readFileSync(assets.regular)),
  bold: assets.bold ? new Uint8Array(readFileSync(assets.bold)) : undefined,
};
const pdf = await exportDocument(doc, fonts, kind);
writeFileSync(output, Buffer.from(pdf));
console.log(`${kind} → ${output} (${pdf.length} bytes, ${doc.pages.length} pages)`);
