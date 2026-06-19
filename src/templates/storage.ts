// Stage 6 (C.8): persist a learned TemplateSpec as REAL JSON — saved to localStorage
// for reuse by Stage 7 generation, and downloadable as a file. No simulated steps.
import type { TemplateSpec } from './templateSpec';

const KEY = 'autospec.templates.v1';

export function listTemplates(): TemplateSpec[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TemplateSpec[]) : [];
  } catch {
    return [];
  }
}

export function saveTemplateLocal(tpl: TemplateSpec): void {
  const all = listTemplates().filter((t) => t.id !== tpl.id);
  all.push(tpl);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteTemplateLocal(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listTemplates().filter((t) => t.id !== id)));
}

/** Trigger a real .json file download of the template. */
export function downloadTemplate(tpl: TemplateSpec): void {
  const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tpl.brand}-${tpl.format}-template.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
