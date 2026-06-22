// Stage 2 (C.4): real PDF import. Drag/drop or pick a PDF → importPdf() → DocumentIR
// (the source of truth). No hardcoded PDF: whatever you drop is what you get.
import React from 'react';
import type { DocumentIR } from '../types/catalog';
import type { TemplateSpec } from '../templates/templateSpec';
import { importPdf } from '../pdf/importPdf';
import { brandLogoUrl } from './brandLogo';
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
    <div style={{ height: '100vh', overflowY: 'auto' }}>
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '34px 24px 64px' }}>
      {/* top bar: secondary routes only (the name is the centred hero below) */}
      <div className="rise rise-1" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, justifyContent: 'flex-start' }}>
        {onGenerate && <button className="btn btn-ghost btn-sm" onClick={onGenerate}>צור קטלוג ←</button>}
        {onLearnTemplate && <button className="btn btn-ghost btn-sm" onClick={onLearnTemplate}>למידת תבנית ←</button>}
      </div>

      {/* hero — the name, large and centred */}
      <div className="rise rise-2" style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: 'clamp(52px, 9vw, 104px)', letterSpacing: '-.03em', lineHeight: 1 }}>
          AutoSpec<span style={{ color: 'var(--accent)' }}>.</span>
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-3)', letterSpacing: '.08em', marginTop: 14 }}>
          סטודיו קטלוגי רכב · עברית RTL
        </div>
      </div>

      {/* intake bay — the signature: a registration-framed drop target */}
      <div className="bay rise rise-3"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
        style={{
          maxWidth: 620, marginInline: 'auto',
          minHeight: 220, borderRadius: 16, cursor: 'pointer',
          border: `1.5px ${over ? 'solid' : 'dashed'} ${over ? 'var(--accent)' : 'var(--line-2)'}`,
          background: over ? 'var(--accent-soft)' : 'var(--surface)',
          boxShadow: over ? 'none' : 'var(--shadow-card)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
          transition: 'border-color .14s ease-out, background .14s ease-out, box-shadow .14s ease-out',
        }}
      >
        {busy
          ? <><span className="spinner" style={{ borderColor: 'var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
              <div className="display" style={{ fontSize: 20 }}>מייבא…</div>
              <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>מחלץ טקסט ומרנדר עמודים</div></>
          : <><div className="display" style={{ fontSize: 22 }}>גררו PDF לכאן</div>
              <div style={{ color: 'var(--ink-3)' }}>או לחצו לבחירת קובץ מהמחשב</div></>}
        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>{err}</div>}
        <input ref={inputRef} type="file" accept="application/pdf" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, maxWidth: 620, marginInline: 'auto' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em' }}>PDF</span>
        <div className="dim-rule" style={{ flex: 1, margin: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em' }}>עברית · RTL</span>
      </div>

      {/* Milestone C: library — saved templates + in-progress projects, FOLDERED BY BRAND */}
      {projects.length > 0 && (
        <Section title={`פרויקטים בעבודה (${projects.length})`}>
          {groupByBrand(projects, (p) => p.doc.brand).map(([brand, items]) => (
            <BrandFolder key={brand} brand={brand} count={items.length}>
              {items.map((p) => (
                <Card key={p.id} thumb={p.thumbnail} title={p.name} sub={`${p.doc.pages.length} עמ׳ · ${rel(p.savedAt)}`}
                  onOpen={() => onOpenProject?.(p.doc)} openLabel="פתח"
                  onDelete={async () => { await deleteProject(p.id); refresh(); }} />
              ))}
            </BrandFolder>
          ))}
        </Section>
      )}
      {templates.length > 0 && (
        <Section title={`תבניות שמורות (${templates.length})`}>
          {groupByBrand(templates, (t) => t.spec.brand).map(([brand, items]) => (
            <BrandFolder key={brand} brand={brand} count={items.length}>
              {items.map((t) => (
                <Card key={t.id} thumb={t.thumbnail} title={t.name} sub={`${t.spec.pages.length} עמ׳ · ${rel(t.savedAt)}`}
                  onOpen={() => onUseTemplate?.(t.spec)} openLabel="צור קטלוג"
                  onDuplicate={async () => { await duplicateTemplate(t.id); refresh(); }}
                  onDelete={async () => { await deleteTemplate(t.id); refresh(); }} />
              ))}
            </BrandFolder>
          ))}
        </Section>
      )}
    </div>
    </div>
  );
}

const BRAND_HE: Record<string, string> = {
  peugeot: 'פיג׳ו', citroen: 'סיטרואן', opel: 'אופל', mg: 'MG', unknown: 'אחר / לא מזוהה',
};
function brandLabel(b?: string): string { const k = (b || 'unknown').toLowerCase(); return BRAND_HE[k] || (b || 'אחר'); }

/** Group library items by brand, sorted by item count (largest first), "unknown" last. */
function groupByBrand<T>(items: T[], getBrand: (t: T) => string | undefined): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = (getBrand(it) || 'unknown').toLowerCase();
    (map.get(key) || map.set(key, []).get(key)!).push(it);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 'unknown') return 1; if (b[0] === 'unknown') return -1;
    return b[1].length - a[1].length;
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span className="display" style={{ fontSize: 17 }}>{title}</span>
        <div className="dim-rule" style={{ flex: 1, margin: 0 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

/** A collapsible per-brand folder holding its cards in a responsive grid. */
function BrandFolder({ brand, count, children }: { brand: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  const initial = brandLabel(brand).replace(/[^A-Za-z֐-׿]/g, '').slice(0, 2) || '#';
  const logo = brandLogoUrl(brand);
  return (
    <div className="lift-card" style={{ borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', cursor: 'pointer', background: 'transparent', border: 'none', borderBottom: open ? '1px solid var(--line)' : 'none' }}>
        {/* marque tile — the real brand logo on a clean chip, else a graphite initials bezel */}
        {logo
          ? <span style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', padding: 5, flexShrink: 0 }}>
              <img src={logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
            </span>
          : <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--side)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{initial}</span>}
        <span className="display" style={{ fontSize: 14.5 }}>{brandLabel(brand)}</span>
        <span className="readout" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{String(count).padStart(2, '0')}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--ink-3)', fontSize: 11, transition: 'rotate .16s ease-out', rotate: open ? '0deg' : '-90deg' }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: 12, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{children}</div>
      )}
    </div>
  );
}

function Card({ thumb, title, sub, onOpen, openLabel, onDuplicate, onDelete }: {
  thumb?: string; title: string; sub: string; onOpen: () => void; openLabel: string;
  onDuplicate?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="lift-card" style={{ borderRadius: 12, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={onOpen} title={openLabel} style={{ cursor: 'pointer', border: 'none', padding: 0, background: 'var(--surface-2)', aspectRatio: '16/9', overflow: 'hidden' }}>
        {thumb ? <img src={thumb} alt="" className="ui-img" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>אין תצוגה</div>}
      </button>
      <div style={{ padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div className="display" style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={title}>{title}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '.02em' }}>{sub}</div>
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
