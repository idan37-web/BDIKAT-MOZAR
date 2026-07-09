// In-app print route (#print): renders the current document through PrintView with the
// dedicated print stylesheet, runs the browser-measured fit pass, and lets the user print
// (Ctrl/⌘+P) — the same rendering path the headless html-print exporter drives.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import { PrintView } from './PrintView';
import { printCss } from './printCss';
import { printFitPass } from './fitPass';

export function PrintRoute({ doc, fontFamily, onBack }: { doc: DocumentIR; fontFamily?: string; onBack: () => void }) {
  React.useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => { if (alive) printFitPass(); });
    return () => { alive = false; };
  }, [doc]);
  const first = doc.pages[0];
  return (
    <div>
      <style>{printCss(first?.width || 595, first?.height || 842)}</style>
      <div className="no-print" style={{
        position: 'fixed', top: 10, insetInlineStart: 10, zIndex: 100, display: 'flex', gap: 8,
        background: '#fff', padding: '8px 10px', borderRadius: 10, boxShadow: '0 4px 18px rgba(0,0,0,.35)', alignItems: 'center',
      }}>
        <button className="btn btn-sm" onClick={() => window.print()} style={{ fontSize: 13 }}>🖨 הדפסה / PDF</button>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 13 }}>← חזרה לעורך</button>
        <span style={{ fontSize: 11, color: '#666' }}>תצוגת הדפסה (פיילוט)</span>
      </div>
      <PrintView doc={doc} fontFamily={fontFamily} />
    </div>
  );
}
