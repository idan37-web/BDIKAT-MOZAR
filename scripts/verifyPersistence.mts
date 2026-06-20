// Milestone C gate — templates + projects persist in IndexedDB across an app "restart".
// Uses fake-indexeddb to provide a real IndexedDB API in Node. Run: `npm run verify:persistence`.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { importPdf } from '../src/pdf/importPdf';
import { learnTemplate } from '../src/templates/templateLearning';
import { generateCatalog, dynamicSlots } from '../src/catalog/generateCatalog';
import {
  saveTemplate, listTemplates, getTemplate, duplicateTemplate, deleteTemplate,
  saveProject, listProjects, getProject, deleteProject,
} from '../src/store/library';
import { _resetConnection } from '../src/store/db';

const checks: { name: string; pass: boolean }[] = [];
const expect = (name: string, pass: boolean) => checks.push({ name, pass });

const imp = async (f: string) => {
  const b = readFileSync(f);
  return importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('/').pop()!, { renderPreviews: false });
};

const tpl = learnTemplate([await imp('project/uploads/PEUGEOT/PRIVATE/3008.pdf'), await imp('project/uploads/PEUGEOT/PRIVATE/5008.pdf')]);
const model = dynamicSlots(tpl).find((s) => s.slot.kind === 'model-name')!.slot;
const doc = generateCatalog(tpl, { [model.key]: { key: model.key, text: 'פיג׳ו 408' } });

// save a template + a project
await saveTemplate(tpl, undefined);
await saveProject(doc, { name: 'פיג׳ו 408', templateId: tpl.id });

// simulate closing + reopening the app (drop the cached connection → fresh open)
_resetConnection();

const t1 = await listTemplates();
const p1 = await listProjects();
expect('template persisted across reopen', t1.length === 1 && t1[0].spec.id === tpl.id);
expect('template round-trips intact', t1[0].spec.pages.length === tpl.pages.length);
expect('project persisted across reopen', p1.length === 1 && p1[0].doc.id === doc.id);
expect('project name + link kept', p1[0].name === 'פיג׳ו 408' && p1[0].templateId === tpl.id);
expect('project doc round-trips (block counts)', p1[0].doc.pages[0].blocks.length === doc.pages[0].blocks.length);

// duplicate a template
const dup = await duplicateTemplate(tpl.id);
expect('duplicate creates a new id', !!dup && dup.id !== tpl.id);
expect('library now lists 2 templates', (await listTemplates()).length === 2);
expect('getTemplate fetches by id', (await getTemplate(tpl.id))?.spec.brand === tpl.brand);

// delete
await deleteProject(doc.id);
expect('project deleted', (await listProjects()).length === 0);
await deleteTemplate(dup!.id);
expect('one template remains after deleting the copy', (await listTemplates()).length === 1);
expect('getProject returns undefined after delete', (await getProject(doc.id)) === undefined);

let ok = true;
for (const c of checks) { console.log(`${c.pass ? '✓' : '✗'} ${c.name}`); if (!c.pass) ok = false; }
if (!ok) { console.error('PERSISTENCE VERIFY FAILED'); process.exit(1); }
console.log('MILESTONE C (PERSISTENCE) CHECKS PASSED');
