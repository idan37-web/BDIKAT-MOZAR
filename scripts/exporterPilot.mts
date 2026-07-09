// Exporter pilot judgment (approved architecture change): run the round-1 export behaviours
// (F2 bidi round-trip, F5 cell vertical alignment, F6 cell containment, F7 decorative shapes)
// against BOTH exporters — pdf-lib (current default) and html-print (headless-Chromium print of
// the PrintView) — on the real fixtures, plus an SSIM comparison of each export against an
// editor screenshot of the same page. Prints and writes the side-by-side judgment table.
// Never throws on a failing check: a red html-print result is DATA, not a build failure.
//
//   npx tsx scripts/exporterPilot.mts
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright-core';
import { createCanvas } from '@napi-rs/canvas';
import { importPdf } from '../src/pdf/importPdf';
import { exportPdf } from '../src/pdf/exportPdf';
import { exportPdfHtmlPrint } from '../src/print/exportHtmlPdf';
import { fontFaceCss } from '../src/print/printCss';
import { roundTripWith } from '../tests/helpers/f2oracle';
import { fitTableBlock } from '../src/catalog/autofit';
import { PageView } from '../src/app/PageView';
import type { DocumentIR, PageIR, TableBlockIR, ShapeBlockIR, CellVAlign } from '../src/types/catalog';

const OUT = '_pilot/out';
mkdirSync(OUT, { recursive: true });

// One font config for BOTH exporters (the locked tests' known-green config) — identical inputs,
// fair comparison. The pilot judges the EXPORT PATH, not the font.
const fonts = {
  regular: new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Regular.otf')),
  bold: new Uint8Array(readFileSync('src/assets/PeugeotNewHebrew-Bold.otf')),
  family: 'BrandEmbed',
};

let browser: Browser;
const pdfLibExport = (doc: DocumentIR) => exportPdf(doc, fonts.regular, fonts.bold);
const htmlPrintExport = (doc: DocumentIR) => exportPdfHtmlPrint(doc, fonts, { browser });
type Exporter = { name: 'pdf-lib' | 'html-print'; fn: (d: DocumentIR) => Promise<Uint8Array> };

// ---------------------------------------------------------------------------- python helpers
function py(code: string, ...args: string[]): string {
  return execFileSync('python3', ['-c', code, ...args]).toString().trim();
}
function glyphs(pdfPath: string, pageIdx: number): { c: string; x: number; y: number; x0: number }[] {
  return JSON.parse(py(`
import fitz, json, sys
d=fitz.open(sys.argv[1]); pg=d[int(sys.argv[2])]
chars=[]
for b in pg.get_text('rawdict')['blocks']:
  for l in b.get('lines',[]):
    for s in l.get('spans',[]):
      for ch in s.get('chars',[]):
        x0,y0,x1,y1=ch['bbox']
        if ch['c'].strip(): chars.append({'c':ch['c'],'x':(x0+x1)/2,'y':(y0+y1)/2,'x0':x0})
print(json.dumps(chars))
`, pdfPath, String(pageIdx)));
}
function drawings(pdfPath: string, pageIdx: number): { x: number; y: number; w: number; h: number; fill: string | null }[] {
  return JSON.parse(py(`
import fitz, json, sys
d=fitz.open(sys.argv[1]); pg=d[int(sys.argv[2])]; res=[]
for dr in pg.get_drawings():
  r=dr['rect']; f=dr.get('fill')
  col='#%02x%02x%02x'%(int(f[0]*255),int(f[1]*255),int(f[2]*255)) if f else None
  res.append({'x':round(r.x0,1),'y':round(r.y0,1),'w':round(r.width,1),'h':round(r.height,1),'fill':col})
print(json.dumps(res))
`, pdfPath, String(pageIdx)));
}
function pdfToPng(pdfPath: string, pageIdx: number, outPng: string, dpi = 72): void {
  py(`
import fitz, sys
fitz.open(sys.argv[1])[int(sys.argv[2])].get_pixmap(dpi=int(sys.argv[4])).save(sys.argv[3])
print('ok')
`, pdfPath, String(pageIdx), outPng, String(dpi));
}
/** darkest ink left of xEdge (pt) in the page raster — the VISUAL spill check (clip-aware,
 * unlike content-stream glyph boxes which survive clipping in a Chromium-printed PDF). */
function inkLeftOf(pdfPath: string, pageIdx: number, xEdgePt: number): number {
  return Number(py(`
import fitz, sys
pg=fitz.open(sys.argv[1])[int(sys.argv[2])]
pix=pg.get_pixmap(dpi=144)
xcut=int(float(sys.argv[3])*2)  # 144dpi = 2 px per pt
dark=0
stride=pix.width*pix.n
s=pix.samples
for yy in range(pix.height):
  row=yy*stride
  for xx in range(min(xcut,pix.width)):
    p=row+xx*pix.n
    if s[p]<100 and s[p+1]<100 and s[p+2]<100: dark+=1
print(dark)
`, pdfPath, String(pageIdx), String(xEdgePt)));
}
function ssimScore(a: string, b: string): number {
  return Number(execFileSync('python3', ['scripts/ssim.py', a, b]).toString().trim());
}

// ---------------------------------------------------------------------------- doc/import utils
const docCache = new Map<string, DocumentIR>();
async function fixtureDoc(name: string): Promise<DocumentIR> {
  if (docCache.has(name)) return docCache.get(name)!;
  const b = readFileSync(`tests/fixtures/${name}`);
  const doc = await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), name, {
    renderPreviews: false, reconstructTables: true,
    makeCanvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  });
  docCache.set(name, doc);
  return doc;
}
const exportCache = new Map<string, string>();
async function exportedPath(fixture: string, ex: Exporter): Promise<string> {
  const key = `${fixture}:${ex.name}`;
  if (exportCache.has(key)) return exportCache.get(key)!;
  const doc = await fixtureDoc(fixture);
  const bytes = await ex.fn(doc);
  const p = `${OUT}/${fixture.replace(/\.pdf$/, '')}.${ex.name}.pdf`;
  writeFileSync(p, Buffer.from(bytes));
  exportCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------- synthetic docs
const tallTable = (vAlign: CellVAlign): DocumentIR => ({
  id: 'd', pages: [{
    id: 'p', width: 600, height: 400, rotation: 0, blocks: [{
      id: 'tb', type: 'table', x: 40, y: 40, width: 200, height: 90, rotation: 0, zIndex: 1, source: 'original',
      originalBBox: { x: 40, y: 40, width: 200, height: 90 },
      columns: 2, colFractions: [0.6, 0.4], rowHeight: 90,
      rows: [{ kind: 'data', cells: ['גובה', '159'] }],
      fontFamily: 'sans-serif', fontSize: 12, color: '#111418', direction: 'rtl', vAlign,
    } as TableBlockIR],
  }],
});
const overflowDoc = (): DocumentIR => {
  const t: TableBlockIR = {
    id: 'tb', type: 'table', x: 40, y: 40, width: 200, height: 16, rotation: 0, zIndex: 1, source: 'original',
    originalBBox: { x: 40, y: 40, width: 200, height: 16 }, columns: 2, colFractions: [0.7, 0.3], rowHeight: 16,
    rows: [{ kind: 'data', cells: ['תווית', 'ערך ארוך במיוחד שאינו נכנס לרוחב העמודה הצרה הזאת'] }],
    fontFamily: 'sans-serif', fontSize: 12, color: '#111418', direction: 'rtl',
  } as TableBlockIR;
  fitTableBlock(t, (txt, s) => txt.length * s * 0.5);
  return { id: 'd', pages: [{ id: 'p', width: 400, height: 200, rotation: 0, blocks: [t] }] };
};

// ---------------------------------------------------------------------------- editor screenshot
async function editorScreenshot(page: PageIR, outPng: string): Promise<void> {
  const markup = renderToStaticMarkup(React.createElement(PageView, {
    page, scale: 1, mode: 'reconstructed', fontFamily: `'${fonts.family}'`,
  } as never));
  const face = fontFaceCss({ family: fonts.family, regularB64: Buffer.from(fonts.regular).toString('base64'), boldB64: Buffer.from(fonts.bold).toString('base64') });
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${face}</style><style>html,body{margin:0;padding:0;background:#fff}</style></head><body>${markup}</body></html>`;
  const p = await browser.newPage();
  await p.setViewportSize({ width: Math.ceil(page.width), height: Math.ceil(page.height) });
  await p.setContent(html, { waitUntil: 'load' });
  await p.evaluate('document.fonts.ready');
  await p.screenshot({ path: outPng, clip: { x: 0, y: 0, width: page.width, height: page.height } });
  await p.close();
}

// ---------------------------------------------------------------------------- judgment rows
interface Row { check: string; fixture: string; pdfLib: string; htmlPrint: string }
const rows: Row[] = [];
const cell = (r: Partial<Record<'pdf-lib' | 'html-print', string>>) => ({ pdfLib: r['pdf-lib'] || '—', htmlPrint: r['html-print'] || '—' });

async function main() {
  browser = await chromium.launch({ executablePath: process.env.AUTOSPEC_CHROMIUM || '/opt/pw-browsers/chromium' });
  const exporters: Exporter[] = [
    { name: 'pdf-lib', fn: pdfLibExport },
    { name: 'html-print', fn: htmlPrintExport },
  ];

  // ---- F2: bidi round-trip (unedited blocks identical to source) ----
  for (const fixture of ['c3-spec-page.pdf', 'c3-dealer-strip.pdf']) {
    const res: Record<string, string> = {};
    for (const ex of exporters) {
      try {
        const { total, mismatches } = await roundTripWith(fixture, ex.fn);
        res[ex.name] = mismatches.length === 0
          ? `PASS (${total} blocks)`
          : `FAIL (${mismatches.length}/${total}: ${JSON.stringify(mismatches[0]).slice(0, 90)}…)`;
      } catch (e) { res[ex.name] = `ERROR ${(e as Error).message.slice(0, 60)}`; }
      console.log(`F2 ${fixture} [${ex.name}]: ${res[ex.name]}`);
    }
    rows.push({ check: 'F2 bidi round-trip', fixture, ...cell(res) });
  }

  // ---- F5: cell vertical alignment moves the drawn baseline ----
  {
    const res: Record<string, string> = {};
    for (const ex of exporters) {
      try {
        const ys: Record<CellVAlign, number> = { top: 0, middle: 0, bottom: 0 };
        for (const v of ['top', 'middle', 'bottom'] as CellVAlign[]) {
          const bytes = await ex.fn(tallTable(v));
          const p = `${OUT}/f5-${v}.${ex.name}.pdf`;
          writeFileSync(p, Buffer.from(bytes));
          const g = glyphs(p, 0).filter((c) => '159'.includes(c.c));
          ys[v] = Math.min(...g.map((c) => c.y));
        }
        const ok = ys.top < ys.middle - 5 && ys.bottom > ys.middle + 5;
        res[ex.name] = `${ok ? 'PASS' : 'FAIL'} (top=${ys.top.toFixed(1)} mid=${ys.middle.toFixed(1)} bot=${ys.bottom.toFixed(1)})`;
      } catch (e) { res[ex.name] = `ERROR ${(e as Error).message.slice(0, 60)}`; }
      console.log(`F5 vAlign [${ex.name}]: ${res[ex.name]}`);
    }
    rows.push({ check: 'F5 cell vertical alignment', fixture: 'synthetic table', ...cell(res) });
  }

  // ---- F6: overflowing cell text stays inside the cell (visual, clip-aware) ----
  {
    const res: Record<string, string> = {};
    for (const ex of exporters) {
      try {
        const bytes = await ex.fn(overflowDoc());
        const p = `${OUT}/f6.${ex.name}.pdf`;
        writeFileSync(p, Buffer.from(bytes));
        const g = glyphs(p, 0);
        const ink = inkLeftOf(p, 0, 39); // dark raster pixels left of the cell edge = visual spill
        const drawn = g.length > 3;
        res[ex.name] = `${ink === 0 && drawn ? 'PASS' : 'FAIL'} (spill-ink=${ink}px, glyphs=${g.length})`;
      } catch (e) { res[ex.name] = `ERROR ${(e as Error).message.slice(0, 60)}`; }
      console.log(`F6 cell containment [${ex.name}]: ${res[ex.name]}`);
    }
    rows.push({ check: 'F6 cell containment', fixture: 'synthetic overflow', ...cell(res) });
  }

  // ---- F7: decorative chip + separator survive to export ----
  {
    const res: Record<string, string> = {};
    const doc = await fixtureDoc('c3-spec-page.pdf');
    const shapes = doc.pages[0].blocks.filter((b) => b.type === 'shape' || b.type === 'background') as ShapeBlockIR[];
    const chip = shapes
      .filter((s) => !(s as ShapeBlockIR & { line?: boolean }).line && s.width > 60 && s.height >= 6 && s.height <= 60 && (s.fill || '').toLowerCase() !== '#ffffff')
      .sort((a, b) => b.width - a.width)[0];
    for (const ex of exporters) {
      try {
        const p = await exportedPath('c3-spec-page.pdf', ex);
        const d = drawings(p, 0);
        const m = chip && d.find((r) => Math.abs(r.x - chip.x) <= 1 && Math.abs(r.y - chip.y) <= 1 && Math.abs(r.w - chip.width) <= 1.5 && Math.abs(r.h - chip.height) <= 1.5);
        const colorOk = m && (m.fill || '').toLowerCase() === (chip.fill || '').toLowerCase();
        const seps = d.filter((r) => r.w > 100 && r.h <= 2).length;
        res[ex.name] = `${m && colorOk && seps > 0 ? 'PASS' : 'FAIL'} (chip=${m ? `hit${colorOk ? '+color' : ', WRONG color ' + m.fill} ` : 'MISS'}, separators=${seps})`;
      } catch (e) { res[ex.name] = `ERROR ${(e as Error).message.slice(0, 60)}`; }
      console.log(`F7 shapes [${ex.name}]: ${res[ex.name]}`);
    }
    rows.push({ check: 'F7 decorative shapes', fixture: 'c3-spec-page.pdf', ...cell(res) });
  }

  // ---- SSIM: export raster vs editor screenshot, per representative page ----
  const ssimTargets: { fixture: string; pageIdx: number; label: string }[] = [
    { fixture: 'c3-spec-page.pdf', pageIdx: 0, label: 'spec tables' },
    { fixture: 'c3-dealer-strip.pdf', pageIdx: 0, label: 'dealer strip' },
    { fixture: 'citroen-c3.pdf', pageIdx: 0, label: 'photo cover' },
    { fixture: 'citroen-c3.pdf', pageIdx: 9, label: 'spec grid page' },
    { fixture: 'peugeot-3008.pdf', pageIdx: 13, label: 'trim comparison' },
  ];
  for (const t of ssimTargets) {
    const res: Record<string, string> = {};
    try {
      const doc = await fixtureDoc(t.fixture);
      const page = doc.pages[t.pageIdx];
      if (!page) { rows.push({ check: `SSIM vs editor (${t.label})`, fixture: `${t.fixture} p${t.pageIdx}`, pdfLib: 'n/a', htmlPrint: 'n/a' }); continue; }
      const shot = `${OUT}/${t.fixture.replace(/\.pdf$/, '')}.p${t.pageIdx}.editor.png`;
      await editorScreenshot(page, shot);
      for (const ex of exporters) {
        const p = await exportedPath(t.fixture, ex);
        const png = `${OUT}/${t.fixture.replace(/\.pdf$/, '')}.p${t.pageIdx}.${ex.name}.png`;
        pdfToPng(p, t.pageIdx, png);
        res[ex.name] = ssimScore(shot, png).toFixed(4);
        console.log(`SSIM ${t.fixture} p${t.pageIdx} [${ex.name}]: ${res[ex.name]}`);
      }
    } catch (e) {
      const msg = `ERROR ${(e as Error).message.slice(0, 60)}`;
      res['pdf-lib'] = res['pdf-lib'] || msg; res['html-print'] = res['html-print'] || msg;
      console.log(`SSIM ${t.fixture} p${t.pageIdx}: ${msg}`);
    }
    rows.push({ check: `SSIM vs editor (${t.label})`, fixture: `${t.fixture} p${t.pageIdx}`, ...cell(res) });
  }

  await browser.close();

  // ---- report ----
  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const w1 = Math.max(...rows.map((r) => r.check.length), 5) + 1;
  const w2 = Math.max(...rows.map((r) => r.fixture.length), 7) + 1;
  const w3 = Math.max(...rows.map((r) => r.pdfLib.length), 7) + 1;
  let table = `${pad('check', w1)}| ${pad('fixture', w2)}| ${pad('pdf-lib', w3)}| html-print\n`;
  table += `${'-'.repeat(w1)}|${'-'.repeat(w2 + 1)}|${'-'.repeat(w3 + 1)}|${'-'.repeat(24)}\n`;
  for (const r of rows) table += `${pad(r.check, w1)}| ${pad(r.fixture, w2)}| ${pad(r.pdfLib, w3)}| ${r.htmlPrint}\n`;
  console.log('\n' + table);

  const md = `# Exporter pilot — judgment table\n\nGenerated by \`scripts/exporterPilot.mts\` on ${new Date().toISOString().slice(0, 16)}Z.\nBoth exporters received the SAME imported documents and the SAME embedded font (Peugeot Hebrew — the locked tests' configuration).\nSSIM compares each export's raster (72 dpi) against a headless-Chromium screenshot of the EDITOR rendering (PageView, reconstructed mode) of the same page.\n\n| check | fixture | pdf-lib | html-print |\n|---|---|---|---|\n${rows.map((r) => `| ${r.check} | ${r.fixture} | ${r.pdfLib} | ${r.htmlPrint} |`).join('\n')}\n\nArtifacts (exports, rasters, screenshots): \`_pilot/out/\` (not committed).\n`;
  writeFileSync('docs/EXPORTER_PILOT.md', md);
  console.log('written: docs/EXPORTER_PILOT.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
