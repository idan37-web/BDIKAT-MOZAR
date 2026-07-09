// Exporter flag (pilot). The Block IR is the single source of truth; both exporters derive a
// PDF from it. DEFAULT stays 'pdf-lib' — flipping it is a separate decision after the pilot's
// judgment table. NODE-ONLY consumers (scripts/tests) may pick 'html-print'; the app UI keeps
// calling the pdf-lib exporter directly and is untouched by this flag.
import type { DocumentIR } from '../types/catalog';
import { exportPdf } from '../pdf/exportPdf';

export type ExporterKind = 'pdf-lib' | 'html-print';

export const DEFAULT_EXPORTER: ExporterKind = 'pdf-lib';

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
