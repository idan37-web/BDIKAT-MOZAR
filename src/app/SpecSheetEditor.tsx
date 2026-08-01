// A clear, row-based editor for the structured SpecSheet — far easier than editing the
// generated table cube-by-cube. Each technical-spec SECTION has its own heading and a small
// table (label | unit | value per trim); equipment is grouped lists of sentences; colours are
// split exterior/interior. Edits flow up as a new SpecSheet (→ mapSheetToCatalog).
import React from 'react';
import type { SpecSheet, ColorType } from '../data/specModel';

const box: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 };
const inp: React.CSSProperties = { padding: '5px 7px', borderRadius: 7, border: '1px solid var(--line-2)', fontFamily: 'var(--font)', fontSize: 13, minWidth: 0 };
const head: React.CSSProperties = { fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 };
const mini = 'btn btn-ghost btn-sm';

export function SpecSheetEditor({ sheet, onChange }: { sheet: SpecSheet; onChange: (s: SpecSheet) => void }) {
  const upd = (fn: (s: SpecSheet) => void) => { const s = structuredClone(sheet); fn(s); onChange(s); };
  const trims = sheet.trims;
  const nT = trims.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* meta + trims */}
      <div style={box}>
        <div style={head}>פרטי דגם</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inp, flex: 1 }} placeholder="מותג" value={sheet.brand || ''} onChange={(e) => upd((s) => { s.brand = e.target.value; })} />
          <input style={{ ...inp, flex: 1 }} placeholder="דגם" value={sheet.model || ''} onChange={(e) => upd((s) => { s.model = e.target.value; })} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>גרסאות / רמות גימור</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {trims.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <input style={{ ...inp, width: 110 }} value={t} onChange={(e) => upd((s) => { s.trims[i] = e.target.value; })} />
              {nT > 1 && <button className={mini} title="הסר גרסה" onClick={() => upd((s) => {
                s.trims.splice(i, 1);
                s.sections.forEach((sec) => sec.rows.forEach((r) => r.values.splice(i, 1)));
                s.features.forEach((c) => c.items.forEach((it) => it.perTrim.splice(i, 1)));
              })}>✕</button>}
            </span>
          ))}
          <button className={mini} onClick={() => upd((s) => {
            s.trims.push(`גרסה ${s.trims.length + 1}`);
            s.sections.forEach((sec) => sec.rows.forEach((r) => r.values.push('')));
            s.features.forEach((c) => c.items.forEach((it) => it.perTrim.push(false)));
          })}>+ גרסה</button>
        </div>
      </div>

      {/* technical spec: sections with headings + rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={head}>מפרט טכני <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 12 }}>(נתונים מספריים, מקובצים לפי אזור)</span></div>
        {sheet.sections.map((sec, si) => (
          <div key={si} style={box}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...inp, flex: 1, fontWeight: 700, background: 'var(--surface-2)' }} placeholder="שם האזור (למשל: מנוע / מידות / היגוי)" value={sec.title}
                onChange={(e) => upd((s) => { s.sections[si].title = e.target.value; })} />
              <button className={mini} style={{ color: 'var(--danger)' }} onClick={() => upd((s) => { s.sections.splice(si, 1); })}>מחק אזור</button>
            </div>
            {/* column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: `1.6fr 0.7fr ${trims.map(() => '0.9fr').join(' ')} auto`, gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
              <span>תווית</span><span>יחידה</span>{trims.map((t, i) => <span key={i} style={{ textAlign: 'center' }}>{t}</span>)}<span />
            </div>
            {sec.rows.map((r, ri) => (
              <div key={ri} style={{ display: 'grid', gridTemplateColumns: `1.6fr 0.7fr ${trims.map(() => '0.9fr').join(' ')} auto`, gap: 6 }}>
                <input style={inp} dir="rtl" placeholder="תווית" value={r.label} onChange={(e) => upd((s) => { s.sections[si].rows[ri].label = e.target.value; })} />
                <input style={inp} placeholder="יח׳" value={r.unit || ''} onChange={(e) => upd((s) => { s.sections[si].rows[ri].unit = e.target.value || undefined; })} />
                {trims.map((_, ti) => (
                  <input key={ti} style={{ ...inp, textAlign: 'center' }} value={r.values[ti] ?? ''} onChange={(e) => upd((s) => { s.sections[si].rows[ri].values[ti] = e.target.value; })} />
                ))}
                <button className={mini} title="מחק שורה" onClick={() => upd((s) => { s.sections[si].rows.splice(ri, 1); })}>✕</button>
              </div>
            ))}
            <button className={mini} style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.sections[si].rows.push({ label: '', values: new Array(nT).fill('') }); })}>+ שורה</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.sections.push({ title: 'אזור חדש', rows: [{ label: '', values: new Array(nT).fill('') }] }); })}>+ אזור מפרט</button>
      </div>

      {/* equipment: categories with sentence items + per-trim ✓ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={head}>מפרט אבזור <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 12 }}>(משפטים, ✓ לכל גרסה)</span></div>
        {sheet.features.map((cat, ci) => (
          <div key={ci} style={box}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...inp, flex: 1, fontWeight: 700, background: 'var(--surface-2)' }} placeholder="קטגוריה (בטיחות / נוחות / מולטימדיה)" value={cat.title}
                onChange={(e) => upd((s) => { s.features[ci].title = e.target.value; })} />
              <button className={mini} style={{ color: 'var(--danger)' }} onClick={() => upd((s) => { s.features.splice(ci, 1); })}>מחק</button>
            </div>
            {cat.items.map((it, ii) => (
              <div key={ii} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={{ ...inp, flex: 1 }} dir="rtl" placeholder="פריט אבזור" value={it.label} onChange={(e) => upd((s) => { s.features[ci].items[ii].label = e.target.value; })} />
                {trims.map((t, ti) => (
                  <label key={ti} title={t} style={{ fontSize: 11, display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ color: 'var(--ink-3)' }}>{t.slice(0, 4)}</span>
                    <input type="checkbox" checked={!!it.perTrim[ti]} onChange={(e) => upd((s) => { s.features[ci].items[ii].perTrim[ti] = e.target.checked; })} />
                  </label>
                ))}
                <button className={mini} title="מחק" onClick={() => upd((s) => { s.features[ci].items.splice(ii, 1); })}>✕</button>
              </div>
            ))}
            <button className={mini} style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.features[ci].items.push({ label: '', perTrim: new Array(nT).fill(true) }); })}>+ פריט</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.features.push({ title: 'קטגוריה חדשה', items: [{ label: '', perTrim: new Array(nT).fill(true) }] }); })}>+ קטגוריית אבזור</button>
      </div>

      {/* colours (exterior / interior) + wheels */}
      <ColorWheels sheet={sheet} upd={upd} />

      {/* texts */}
      <div style={box}>
        <div style={head}>טקסטים ומחיר</div>
        <textarea style={{ ...inp, minHeight: 48 }} dir="rtl" placeholder="טקסט שיווקי" value={sheet.marketingText || ''} onChange={(e) => upd((s) => { s.marketingText = e.target.value; })} />
        <textarea style={{ ...inp, minHeight: 40 }} dir="rtl" placeholder="טקסט משפטי" value={sheet.legalText || ''} onChange={(e) => upd((s) => { s.legalText = e.target.value; })} />
        <input style={inp} dir="rtl" placeholder="מחיר" value={sheet.price || ''} onChange={(e) => upd((s) => { s.price = e.target.value; })} />
      </div>
    </div>
  );
}

function ColorWheels({ sheet, upd }: { sheet: SpecSheet; upd: (fn: (s: SpecSheet) => void) => void }) {
  const types: ColorType[] = ['solid', 'metallic', 'pearl'];
  const colorRow = (groupLabel: string, group: 'exterior' | 'interior') => (
    <div style={box}>
      <div style={head}>{groupLabel}</div>
      {sheet.colors.map((c, i) => (c.group === 'interior') === (group === 'interior') ? (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input style={{ ...inp, flex: 1 }} dir="rtl" placeholder="שם הצבע" value={c.name} onChange={(e) => upd((s) => { s.colors[i].name = e.target.value; })} />
          <select style={inp} value={c.type} onChange={(e) => upd((s) => { s.colors[i].type = e.target.value as ColorType; })}>
            {types.map((t) => <option key={t} value={t}>{t === 'solid' ? 'רגיל' : t === 'metallic' ? 'מטאלי' : 'פנינה'}</option>)}
          </select>
          <input type="color" style={{ width: 30, height: 28, padding: 0, border: '1px solid var(--line-2)', borderRadius: 6 }} value={/^#[0-9a-f]{6}$/i.test(c.code || '') ? c.code! : '#cccccc'} onChange={(e) => upd((s) => { s.colors[i].code = e.target.value; })} />
          <button className={mini} title="מחק" onClick={() => upd((s) => { s.colors.splice(i, 1); })}>✕</button>
        </div>
      ) : null)}
      <button className={mini} style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.colors.push({ name: '', type: 'solid', group }); })}>+ צבע</button>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {colorRow('צבעי חוץ', 'exterior')}
      {colorRow('צבעי פנים / ריפוד', 'interior')}
      <div style={box}>
        <div style={head}>חישוקים</div>
        {sheet.wheels.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={{ ...inp, flex: 1 }} dir="rtl" placeholder="תווית" value={w.label} onChange={(e) => upd((s) => { s.wheels[i].label = e.target.value; })} />
            <input style={{ ...inp, width: 90 }} placeholder="מידה" value={w.size || ''} onChange={(e) => upd((s) => { s.wheels[i].size = e.target.value || undefined; })} />
            <button className={mini} title="מחק" onClick={() => upd((s) => { s.wheels.splice(i, 1); })}>✕</button>
          </div>
        ))}
        <button className={mini} style={{ alignSelf: 'flex-start' }} onClick={() => upd((s) => { s.wheels.push({ label: 'חישוקי סגסוגת', size: '' }); })}>+ חישוק</button>
      </div>
    </div>
  );
}
