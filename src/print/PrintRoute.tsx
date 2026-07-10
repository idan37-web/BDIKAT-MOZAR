// In-app print route (#print): renders the current document through PrintView with the
// dedicated print stylesheet, runs the browser-measured fit pass, and prints via the browser's
// own engine — the DEFAULT export path (the same rendering the headless html-print exporter
// drives). `autoPrint` fires the print dialog automatically when the user hit "ייצוא PDF".
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import { PrintView } from './PrintView';
import { printCss } from './printCss';
import { printFitPass } from './fitPass';

export function PrintRoute({ doc, fontFamily, autoPrint, onBack }: { doc: DocumentIR; fontFamily?: string; autoPrint?: boolean; onBack: () => void }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    // fonts must be loaded before the fit pass measures (wrong metrics → wrong shrink/squeeze)
    document.fonts.ready.then(() => { if (alive) { printFitPass(); setReady(true); } });
    return () => { alive = false; };
  }, [doc]);

  // auto-print once the layout is settled; return to the editor when the dialog closes
  React.useEffect(() => {
    if (!autoPrint || !ready) return;
    const after = () => onBack();
    window.addEventListener('afterprint', after);
    const t = setTimeout(() => window.print(), 60); // one frame past the fit pass
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [autoPrint, ready, onBack]);

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
        <span style={{ fontSize: 11, color: '#666' }}>ייצוא דרך הדפדפן (ברירת מחדל)</span>
      </div>
      <PrintView doc={doc} fontFamily={fontFamily} />
    </div>
  );
}
