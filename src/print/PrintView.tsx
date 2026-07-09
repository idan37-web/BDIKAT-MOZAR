// HTML-print export pilot (approved architecture change): render a DocumentIR as printable
// HTML pages in PDF POINTS, mirroring PageView's geometry via the SAME shared helpers
// (columnLeftFraction / resolveVAlign / vAlignToFlex) so the two renders cannot diverge on
// table math. The Block IR stays the single source of truth — this view is derived, never
// stored or edited.
//
// NO bidi reordering anywhere in this path: text is emitted in LOGICAL order with dir +
// unicode-bidi:plaintext, and the browser applies UAX #9 itself. Never import the REORDERING
// functions from engine/bidi — the only shared piece is bidiPrep's numeric-token bridge, which
// is UAX #9 INPUT (isolates + NBSP), the same domain rule the pdf-lib seam applies.
import React from 'react';
import type { DocumentIR, PageIR, TextBlockIR, ImageBlockIR, TableBlockIR, ShapeBlockIR } from '../types/catalog';
import { isTextBlock, isImageBlock, isShapeBlock, isTableBlock, columnLeftFraction, resolveVAlign, vAlignToFlex } from '../types/catalog';
import { bridgeNumericTokens } from '../engine/bidiPrep';
import { edgeShadeBackground } from '../app/imageFx';

export interface PrintViewProps {
  doc: DocumentIR;
  /** brand font stack for imported text (same value App passes to PageView). */
  fontFamily?: string;
}

const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;
const ptRect = (b: { x: number; y: number; width: number; height: number }) =>
  ({ left: pt(b.x), top: pt(b.y), width: pt(b.width), height: pt(b.height) }) as const;

function ShapeEl({ b }: { b: ShapeBlockIR }) {
  return (
    <div style={{
      position: 'absolute', ...ptRect(b),
      background: b.fill || 'transparent', borderRadius: pt(b.radius || 0),
      border: b.stroke ? `${pt(Math.max(0.4, b.stroke.width))} solid ${b.stroke.color}` : undefined,
      opacity: b.opacity ?? 1,
    }} />
  );
}

function ImageEl({ b }: { b: ImageBlockIR }) {
  const c = b.crop && b.crop.fw > 0 && b.crop.fh > 0 ? b.crop : null;
  const imgStyle: React.CSSProperties = c
    ? { position: 'absolute', width: `${100 / c.fw}%`, height: `${100 / c.fh}%`, left: `${(-c.fx * 100) / c.fw}%`, top: `${(-c.fy * 100) / c.fh}%`, objectFit: 'fill' }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: b.fit || 'cover' };
  return (
    <span style={{ position: 'absolute', ...ptRect(b), overflow: 'hidden', display: 'block' }}>
      {b.src ? (
        <img src={b.src} alt="" style={{
          ...imgStyle, opacity: b.opacity ?? 1,
          transform: `rotate(${b.rotation || 0}deg) scaleX(${b.flipH ? -1 : 1})`, transformOrigin: 'center',
        }} />
      ) : (
        // unbound placeholder — neutral frame, same as the vector exporter's fallback
        <span style={{ position: 'absolute', inset: 0, background: '#ebebed', display: 'block' }} />
      )}
      {b.edgeShade && (b.edgeShade.top || b.edgeShade.right || b.edgeShade.bottom || b.edgeShade.left) ? (
        <span style={{ position: 'absolute', inset: 0, display: 'block', background: edgeShadeBackground(b.edgeShade) }} />
      ) : null}
      {b.stroke && (
        <span style={{ position: 'absolute', inset: 0, display: 'block', border: `${pt(b.stroke.width)} solid ${b.stroke.color}`, borderRadius: pt(b.radius || 0), boxSizing: 'border-box' }} />
      )}
    </span>
  );
}

function TableEl({ b, fontFamily }: { b: TableBlockIR; fontFamily?: string }) {
  const nRows = Math.max(1, b.rows.length);
  const rowTop = (r: number) => `${((100 * r) / nRows).toFixed(4)}%`;
  const rowH = `${(100 / nRows).toFixed(4)}%`;
  const grid = b.gridColor || '#d7dade';
  return (
    <div style={{ position: 'absolute', ...ptRect(b), background: b.cellBg || 'transparent' }}>
      {b.rows.map((row, r) => {
        if (row.kind === 'section') {
          return (
            <div key={r} dir="rtl" style={{
              position: 'absolute', left: 0, top: rowTop(r), width: '100%', height: rowH,
              display: 'flex', alignItems: vAlignToFlex(resolveVAlign(b, row)), justifyContent: 'flex-start',
              padding: `0 ${pt(3)}`, boxSizing: 'border-box',
              fontFamily: fontFamily || b.fontFamily, fontSize: pt(b.fontSize), fontWeight: 700,
              background: b.sectionBg || 'transparent', color: b.headingColor || b.color,
              borderBottom: `0.6pt solid ${grid}`, overflow: 'hidden',
            }}>{bridgeNumericTokens(row.cells[0] || '')}</div>
          );
        }
        return Array.from({ length: b.columns }).map((_, c) => {
          const leftFrac = columnLeftFraction(b.colFractions, c);
          const isLabel = c === 0;
          return (
            <div key={`${r}_${c}`} dir="rtl" style={{
              position: 'absolute', left: `${(leftFrac * 100).toFixed(4)}%`, top: rowTop(r),
              width: `${((b.colFractions[c] || 0) * 100).toFixed(4)}%`, height: rowH,
              display: 'flex', alignItems: vAlignToFlex(resolveVAlign(b, row)), justifyContent: isLabel ? 'flex-start' : 'center',
              padding: `0 ${pt(3)}`, boxSizing: 'border-box',
              fontFamily: fontFamily || b.fontFamily, fontSize: pt(b.fontSize), fontWeight: row.kind === 'header' ? 700 : 400,
              color: row.kind === 'header' ? (b.headingColor || b.color) : b.color,
              borderBottom: `0.4pt solid ${grid}`,
              borderInlineStart: c < b.columns - 1 ? `0.4pt solid ${grid}` : undefined,
              overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.2,
              textAlign: isLabel ? 'right' : 'center',
            }}>{bridgeNumericTokens(row.cells[c] ?? '')}</div>
          );
        });
      })}
    </div>
  );
}

function TextEl({ b, fontFamily }: { b: TextBlockIR; fontFamily?: string }) {
  // single-line boxes must not wrap (they get the browser-measured fit pass instead — see fitPass.ts)
  const oneLine = b.height <= b.fontSize * (b.lineHeight || 1.2) * 1.5;
  // an IMPORTED multi-line block carries the SOURCE's own line breaks — render them VERBATIM
  // (white-space:pre) and let the fit pass shrink/squeeze to the widest stored line. Re-wrapping
  // with the (wider) embedded font shifted every following line and pushed the tail out of the
  // box — the same failure planTextLines fixed in the pdf-lib exporter. Blocks without stored
  // breaks (generated content) keep browser wrapping (their boxes were sized by autofit).
  const hasBreaks = b.text.includes('\n');
  const fit = oneLine || hasBreaks;
  return (
    <div
      dir={b.direction === 'ltr' ? 'ltr' : 'rtl'}
      {...(fit ? { 'data-fitline': '1', 'data-anchor': b.direction === 'ltr' && b.align !== 'end' ? 'left' : 'right' } : {})}
      style={{
        position: 'absolute', ...ptRect(b), overflow: 'hidden',
        fontSize: pt(b.fontSize), lineHeight: b.lineHeight,
        fontFamily: fontFamily || b.fontFamily, fontWeight: b.fontWeight, color: b.color,
        whiteSpace: oneLine ? 'nowrap' : hasBreaks ? 'pre' : 'pre-wrap',
        ...(b.rotation ? { transform: `rotate(${b.rotation}deg)`, transformOrigin: '0 77%' } : {}),
        // plaintext lives on whichever node holds the TEXT: with the measurement span the outer
        // paragraph sees only an atomic inline (no strong chars) and plaintext would resolve LTR,
        // anchoring a too-wide RTL span at the LEFT and clipping its rightmost glyphs.
        ...(fit ? {} : { unicodeBidi: 'plaintext' as const }),
        textAlign: b.align === 'end' ? 'right' : b.align === 'center' ? 'center' : 'left',
      }}
    >
      {/* inner span = sub-pixel measurement target for the fit pass (scrollWidth is integer-
          rounded and misses <1px overflows that still poke a glyph past the box in print) */}
      {fit ? <span data-m="1" style={{ display: 'inline-block', unicodeBidi: 'plaintext' }}>{bridgeNumericTokens(b.text)}</span> : bridgeNumericTokens(b.text)}
    </div>
  );
}

export function PrintPage({ page, fontFamily }: { page: PageIR; fontFamily?: string }) {
  const zSorted = page.blocks
    .filter((b) => (isShapeBlock(b) || isImageBlock(b)) && !b.deleted)
    .slice().sort((a, b) => a.zIndex - b.zIndex);
  return (
    <div className="print-page" style={{
      position: 'relative', width: pt(page.width), height: pt(page.height),
      overflow: 'hidden', background: '#fff', breakAfter: 'page',
    }}>
      {zSorted.map((blk) => isShapeBlock(blk)
        ? <ShapeEl key={blk.id} b={blk} />
        : <ImageEl key={blk.id} b={blk as ImageBlockIR} />)}
      {page.blocks.filter(isTableBlock).filter((b) => !b.deleted).map((b) => (
        <TableEl key={b.id} b={b} fontFamily={fontFamily} />
      ))}
      {page.blocks.filter(isTextBlock).filter((b) => !b.deleted).map((b) => (
        <TextEl key={b.id} b={b} fontFamily={fontFamily} />
      ))}
    </div>
  );
}

export function PrintView({ doc, fontFamily }: PrintViewProps) {
  return (
    <div className="print-root">
      {doc.pages.map((p) => <PrintPage key={p.id} page={p} fontFamily={fontFamily} />)}
    </div>
  );
}
