// Stage 2 (C.4): real PDF import. Drag/drop or pick a PDF → importPdf() → DocumentIR
// (the source of truth). No hardcoded PDF: whatever you drop is what you get.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import type { TemplateSpec } from '../templates/templateSpec';
import { importPdf } from '../pdf/importPdf';
import {
  listTemplates, listProjects, duplicateTemplate, deleteTemplate, deleteProject,
  type StoredTemplate, type StoredProject,
} from '../store/library';

interface Props {
  onImported: (doc: DocumentIR) => void;
  onLearnTemplate?: () => void;
  onGenerate?: () => void;
  onOpenProject?: (doc: DocumentIR) => void;
  onUseTemplate?: (spec: TemplateSpec) => void;
}

export function ImportScreen({ onImported, onLearnTemplate, onGenerate, onOpenProject, onUseTemplate }: Props) {
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = React.useState<StoredTemplate[]>([]);
  const [projects, setProjects] = React.useState<StoredProject[]>([]);
  const refresh = React.useCallback(() => {
    listTemplates().then(setTemplates).catch(() => {});
    listProjects().then(setProjects).catch(() => {});
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

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
        {onGenerate && <button className="btn btn-ghost btn-sm" onClick={onGenerate}>צור קטלוג ←</button>}
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

      {/* Milestone C: library — saved templates + in-progress projects (persist across reload) */}
      {projects.length > 0 && (
        <Section title={`פרויקטים בעבודה (${projects.length})`}>
          {projects.map((p) => (
            <Card key={p.id} thumb={p.thumbnail} title={p.name} sub={`${p.doc.pages.length} עמ׳ · ${rel(p.savedAt)}`}
              onOpen={() => onOpenProject?.(p.doc)} openLabel="פתח"
              onDelete={async () => { await deleteProject(p.id); refresh(); }} />
          ))}
        </Section>
      )}
      {templates.length > 0 && (
        <Section title={`תבניות שמורות (${templates.length})`}>
          {templates.map((t) => (
            <Card key={t.id} thumb={t.thumbnail} title={t.name} sub={`${t.spec.pages.length} עמ׳ · ${rel(t.savedAt)}`}
              onOpen={() => onUseTemplate?.(t.spec)} openLabel="צור קטלוג"
              onDuplicate={async () => { await duplicateTemplate(t.id); refresh(); }}
              onDelete={async () => { await deleteTemplate(t.id); refresh(); }} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{children}</div>
    </div>
  );
}

function Card({ thumb, title, sub, onOpen, openLabel, onDuplicate, onDelete }: {
  thumb?: string; title: string; sub: string; onOpen: () => void; openLabel: string;
  onDuplicate?: () => void; onDelete?: () => void;
}) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={onOpen} title={openLabel} style={{ cursor: 'pointer', border: 'none', padding: 0, background: 'var(--surface-2)', aspectRatio: '16/9', overflow: 'hidden' }}>
        {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>אין תצוגה</div>}
      </button>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={title}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button className="btn btn-sm" onClick={onOpen} style={{ flex: 1, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 8px', fontSize: 12 }}>{openLabel}</button>
          {onDuplicate && <button className="btn btn-ghost btn-sm" onClick={onDuplicate} title="שכפל" style={{ fontSize: 12 }}>שכפל</button>}
          {onDelete && <button className="btn btn-ghost btn-sm" onClick={onDelete} title="מחק" style={{ fontSize: 12, color: 'var(--danger)' }}>מחק</button>}
        </div>
      </div>
    </div>
  );
}

function rel(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000); if (m < 1) return 'עכשיו'; if (m < 60) return `לפני ${m} ד׳`;
  const h = Math.floor(m / 60); if (h < 24) return `לפני ${h} ש׳`;
  return new Date(iso).toLocaleDateString('he-IL');
}
