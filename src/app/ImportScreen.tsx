// Stage 2 (C.4): real PDF import. Drag/drop or pick a PDF → importPdf() → DocumentIR
// (the source of truth). No hardcoded PDF: whatever you drop is what you get.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import { importPdf } from '../pdf/importPdf';

export function ImportScreen({ onImported, onLearnTemplate }: { onImported: (doc: DocumentIR) => void; onLearnTemplate?: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setErr(null); setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const doc = await importPdf(buf, file.name, { renderPreviews: true, previewScale: 2 });
      onImported(doc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>ייבוא מפרט PDF</h1>
        <div style={{ flex: 1 }} />
        {onLearnTemplate && <button className="btn btn-ghost btn-sm" onClick={onLearnTemplate}>למידת תבנית ←</button>}
      </div>
      <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>גרור קובץ PDF אמיתי — המערכת מחלצת ממנו טקסט אמיתי (בר-בחירה) ומבנה עמודים.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
        style={{
          marginTop: 22, minHeight: 260, borderRadius: 16, cursor: 'pointer',
          border: `2px dashed ${over ? 'var(--accent)' : 'var(--line-2)'}`,
          background: over ? 'var(--accent-soft)' : 'var(--surface)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>{busy ? 'מייבא…' : 'גרור PDF לכאן'}</div>
        <div style={{ color: 'var(--ink-3)' }}>{busy ? 'מחלץ טקסט ומרנדר עמודים' : 'או לחץ לבחירת קובץ'}</div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        <input ref={inputRef} type="file" accept="application/pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
    </div>
  );
}
