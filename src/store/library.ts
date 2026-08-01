// Milestone C: the templates + projects library on top of IndexedDB.
import type { DocumentIR } from '../types/catalog';
import type { TemplateSpec } from '../templates/templateSpec';
import { idbAll, idbDel, idbGet, idbPut } from './db';

export interface StoredTemplate {
  id: string;
  name: string;
  spec: TemplateSpec;
  thumbnail?: string; // data URL of the source first page (reference)
  savedAt: string;
}

export interface StoredProject {
  id: string;
  name: string;
  doc: DocumentIR;
  templateId?: string;
  thumbnail?: string;
  savedAt: string;
}

const newest = <T extends { savedAt: string }>(a: T[]): T[] => a.sort((x, y) => y.savedAt.localeCompare(x.savedAt));

// ---- templates ----
export async function saveTemplate(spec: TemplateSpec, thumbnail?: string): Promise<StoredTemplate> {
  const rec: StoredTemplate = { id: spec.id, name: `${spec.brand} · ${spec.family}`, spec, thumbnail, savedAt: new Date().toISOString() };
  await idbPut('templates', rec);
  return rec;
}
export async function listTemplates(): Promise<StoredTemplate[]> { return newest(await idbAll<StoredTemplate>('templates')); }
export async function getTemplate(id: string): Promise<StoredTemplate | undefined> { return idbGet('templates', id); }
export async function deleteTemplate(id: string): Promise<void> { return idbDel('templates', id); }
export async function duplicateTemplate(id: string): Promise<StoredTemplate | null> {
  const r = await getTemplate(id);
  if (!r) return null;
  const newId = `${r.spec.id}_copy_${Date.now()}`;
  const copy: StoredTemplate = {
    ...r, id: newId, name: `${r.name} (עותק)`,
    spec: { ...r.spec, id: newId }, savedAt: new Date().toISOString(),
  };
  await idbPut('templates', copy);
  return copy;
}

// ---- projects ----
export async function saveProject(doc: DocumentIR, opts: { name?: string; templateId?: string; thumbnail?: string } = {}): Promise<StoredProject> {
  const rec: StoredProject = {
    id: doc.id,
    name: opts.name || doc.sourcePdfName || 'קטלוג ללא שם',
    doc,
    templateId: opts.templateId,
    thumbnail: opts.thumbnail || doc.pages[0]?.previewImage,
    savedAt: new Date().toISOString(),
  };
  await idbPut('projects', rec);
  return rec;
}
export async function listProjects(): Promise<StoredProject[]> { return newest(await idbAll<StoredProject>('projects')); }
export async function getProject(id: string): Promise<StoredProject | undefined> { return idbGet('projects', id); }
export async function deleteProject(id: string): Promise<void> { return idbDel('projects', id); }
