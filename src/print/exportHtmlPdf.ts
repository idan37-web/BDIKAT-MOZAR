// HTML-print PDF exporter (pilot; NODE-ONLY — drives headless Chromium via playwright-core).
// The Block IR is rendered by PrintView (logical-order text; the BROWSER does UAX #9 bidi and
// all line layout), wrapped in the standalone print shell, and printed with page.pdf() at
// @page size == template page size, so 1 CSS pt == 1 PDF pt.
//
// This module must never enter the app bundle: the app keeps calling the pdf-lib exporter;
// only the export script / pilot tests import this file.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright-core';
import type { DocumentIR } from '../types/catalog';
import { PrintView } from './PrintView';
import { printHtmlShell, type PrintFont } from './printCss';
import { PRINT_FIT_PASS_SRC } from './fitPass';

export interface HtmlPrintFonts {
  regular: Uint8Array;
  bold?: Uint8Array;
  /** CSS family name to register + apply (defaults to 'BrandEmbed'). */
  family?: string;
}

export interface HtmlPrintOptions {
  /** Chromium executable (defaults to the preinstalled Playwright browser). */
  executablePath?: string;
  /** Reuse an already-launched browser (the pilot runs many exports). */
  browser?: Browser;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** Render a DocumentIR to standalone print HTML (also used by tests to inspect the markup). */
export function renderPrintHtml(doc: DocumentIR, fonts: HtmlPrintFonts): string {
  const family = fonts.family || 'BrandEmbed';
  const markup = renderToStaticMarkup(React.createElement(PrintView, { doc, fontFamily: `'${family}'` }));
  const face: PrintFont = { family, regularB64: b64(fonts.regular), boldB64: fonts.bold ? b64(fonts.bold) : undefined };
  const first = doc.pages[0];
  return printHtmlShell(markup, first?.width || 595, first?.height || 842, [face]);
}

/** Export a DocumentIR to PDF through headless Chromium print. Returns the PDF bytes. */
export async function exportPdfHtmlPrint(doc: DocumentIR, fonts: HtmlPrintFonts, opts: HtmlPrintOptions = {}): Promise<Uint8Array> {
  const html = renderPrintHtml(doc, fonts);
  const owns = !opts.browser;
  const browser = opts.browser ?? await chromium.launch({
    executablePath: opts.executablePath || process.env.AUTOSPEC_CHROMIUM || '/opt/pw-browsers/chromium',
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready');
    await page.evaluate(PRINT_FIT_PASS_SRC); // browser-measured single-line fit (same contract as pdf-lib)
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.close();
    return new Uint8Array(pdf);
  } finally {
    if (owns) await browser.close();
  }
}
