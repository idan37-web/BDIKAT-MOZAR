// STRUCTURAL GUARDS — architecture rules that FAIL THE BUILD when violated.
// These scan the SOURCE (not the bundle) so a violation is caught at its origin:
//   A. editor/app components must consume Block objects, never raw pdf.js text items;
//   B. drawText is only ever called through the bidi seam (visual-order conversion);
//   C. image extraction is XObject-based — canvas cropping only as the logged last resort.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(full)) acc.push(full);
  }
  return acc;
}
const read = (f: string) => readFileSync(f, 'utf8');

describe('Guard A — editor consumes the Block model, never raw pdf.js text items', () => {
  it('no src/app or src/editor file touches getTextContent / pdfjs text items', () => {
    const offenders = [...walk('src/app'), ...walk('src/editor')]
      .filter((f) => /getTextContent|TextItem\b|pdfjs-dist/.test(read(f)));
    expect(offenders, `pdf.js text APIs leaked into the editor layer: ${offenders.join(', ')}`).toEqual([]);
  });
  it('getTextContent is used only inside the extraction layer (src/pdf)', () => {
    const outside = walk('src').filter((f) => !f.startsWith(join('src', 'pdf')) && /getTextContent/.test(read(f)));
    expect(outside, `getTextContent outside src/pdf: ${outside.join(', ')}`).toEqual([]);
  });
});

describe('Guard B — drawText only through the bidi wrapper', () => {
  it('every file calling .drawText( imports the bidi seam (engine/bidi or pdf/hebrew)', () => {
    const offenders = walk('src').filter((f) => {
      const src = read(f);
      if (!/\.drawText\(/.test(src)) return false;
      return !/from '[^']*(engine\/bidi|\/hebrew)'/.test(src);
    });
    expect(offenders, `drawText without the bidi seam: ${offenders.join(', ')}`).toEqual([]);
  });
  it('no component/editor file draws PDF text at all', () => {
    const offenders = [...walk('src/app'), ...walk('src/editor')].filter((f) => /\.drawText\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('Guard C — image extraction is XObject-based, canvas crop only as logged fallback', () => {
  it('the op-list walker resolves embedded image XObjects', () => {
    const src = read('src/pdf/extractImages.ts');
    expect(src).toMatch(/paintImageXObject/);
    expect(src).toMatch(/resolveImage/);
  });
  it('importPdf tries resolveImage FIRST; canvas crop only when it fails, with a loud warning', () => {
    const src = read('src/pdf/importPdf.ts');
    const resolveIdx = src.indexOf('await resolveImage(');
    const cropIdx = src.indexOf('cropCanvasErasingText(');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(cropIdx).toBeGreaterThan(resolveIdx); // fallback comes after the XObject attempt
    // the fallback is guarded on resolution failure and logged loudly
    const guardRegion = src.slice(resolveIdx, cropIdx + 200);
    expect(guardRegion).toMatch(/if \(!src/);
    expect(src).toMatch(/RENDER-CROP FALLBACK/);
  });
  it('no other module crops page canvases for image content', () => {
    const offenders = walk('src')
      .filter((f) => !/src[\\/]pdf[\\/](importPdf|renderPage)\.ts$/.test(f))
      .filter((f) => /cropCanvasErasingText|cropCanvas\(/.test(read(f)));
    expect(offenders, `canvas cropping outside the sanctioned fallback: ${offenders.join(', ')}`).toEqual([]);
  });
});
