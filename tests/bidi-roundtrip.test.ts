// F2 — PERMANENT bidi round-trip property: any UNEDITED text block must export text IDENTICAL
// to the source PDF — same characters in the same VISUAL order (brackets facing, digit order,
// punctuation) — across the fixtures. Ground truth is PyMuPDF reading BOTH PDFs the same way:
// characters inside the block's bbox, sorted left→right per line (visual order), whitespace
// stripped, compared over the letter/digit/bracket/punctuation classes the product cares about
// (₪/✓-style symbols excluded — font-encodability is a separate concern from bidi order).
//
// The oracle lives in tests/helpers/f2oracle.ts (shared with the exporter-pilot judgment script);
// THIS file locks the pdf-lib exporter — the assertions are unchanged from the original.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { exportPdf } from '../src/pdf/exportPdf';
import { roundTripWith } from './helpers/f2oracle';

const fontBytes = new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf'));
const pdfLibExport = (doc: Parameters<typeof exportPdf>[0]) => exportPdf(doc, fontBytes);

describe('F2 — bidi round-trip invariant (unedited blocks export identical to source)', () => {
  it('c3-spec-page: every unedited block round-trips (brackets keep their facing)', async () => {
    const { total, mismatches } = await roundTripWith('c3-spec-page.pdf', pdfLibExport);
    expect(total).toBeGreaterThan(20);
    expect(mismatches, JSON.stringify(mismatches.slice(0, 6), null, 1)).toEqual([]);
  }, 240_000);

  it('c3-dealer-strip: every unedited block round-trips (phone digits keep their order)', async () => {
    const { total, mismatches } = await roundTripWith('c3-dealer-strip.pdf', pdfLibExport);
    expect(total).toBeGreaterThan(10);
    expect(mismatches, JSON.stringify(mismatches.slice(0, 6), null, 1)).toEqual([]);
  }, 240_000);
});
