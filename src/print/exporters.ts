// Exporter flag (pilot). The Block IR is the single source of truth; both exporters derive a
// PDF from it. DEFAULT stays 'pdf-lib' — flipping it is a separate decision after the pilot's
// judgment table. NODE-ONLY consumers (scripts/tests) may pick 'html-print'; the app UI keeps
// calling the pdf-lib exporter directly and is untouched by this flag.
import type { DocumentIR } from '../types/catalog';
import { exportPdf } from '../pdf/exportPdf';

export type ExporterKind = 'pdf-lib' | 'html-print';

// The pilot judgment (docs/EXPORTER_PILOT.md) put html-print at functional parity with pdf-lib
// (F2/F5/F6/F7 all green) and SSIM parity vs the editor, so it is now the DEFAULT. pdf-lib is
// kept as an explicit fallback ('pdf-lib') — not deleted — for the single-file offline build,
// which has no headless Chromium to drive the print path.
export const DEFAULT_EXPORTER: ExporterKind = 'html-print';

export interface ExportFonts { regular: Uint8Array; bold?: Uint8Array; family?: string }

/** Dispatch an export through the flagged exporter. 'html-print' requires Node (Playwright). */
export async function exportDocument(doc: DocumentIR, fonts: ExportFonts, kind: ExporterKind = DEFAULT_EXPORTER): Promise<Uint8Array> {
  if (kind === 'html-print') {
    if (typeof window !== 'undefined') throw new Error('html-print exporter runs in Node only (headless Chromium)');
    const { exportPdfHtmlPrint } = await import('./exportHtmlPdf');
    return exportPdfHtmlPrint(doc, fonts);
  }
  return exportPdf(doc, fonts.regular, fonts.bold);
}
