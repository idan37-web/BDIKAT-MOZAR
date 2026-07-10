// Judge with numbers (contract §5): pageType accuracy + per-role precision/recall of
// (a) the CURRENT HEURISTICS vs (b) the AI SEMANTIC LAYER, over the hand-labeled golden set
// (tests/golden/pages.json). The AI path becomes default ONLY if it wins here.
//
//   npx tsx scripts/semanticJudge.mts                 # heuristics only (offline)
//   GEMINI_API_KEY=... npx tsx scripts/semanticJudge.mts   # + the AI column
//
// AI page renders come from PyMuPDF (longest edge <=1400px); results cache to _sem-cache/ so
// reruns never re-bill. Writes docs/SEMANTIC_JUDGE.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { importPdf } from '../src/pdf/importPdf';
import { groupRegions, classifyPage, slotKind, type Region } from '../src/templates/templateLearning';
import { isTablePage } from '../src/templates/tableDetect';
import { KIND_TO_ROLE, ROLE_TO_PAGE_TYPE } from '../src/templates/synthesisV2';
import { buildCompactBlocks } from '../src/ai/payload';
import { GeminiSemanticProvider } from '../src/ai/geminiProvider';
import { BLOCK_ROLES, type PageSemantics } from '../src/ai/semanticSchema';
import type { PageRole } from '../src/templates/templateSpec';
import type { DocumentIR } from '../src/types/catalog';

interface GoldenPage { fixture: string; pageIndex: number; pageType: string; roles: Record<string, string> }
const golden: GoldenPage[] = JSON.parse(readFileSync('tests/golden/pages.json', 'utf-8'));

mkdirSync('_sem-cache', { recursive: true });

// ---------------------------------------------------------------- imports (once per fixture)
const docs = new Map<string, DocumentIR>();
async function docOf(fixture: string): Promise<DocumentIR> {
  if (!docs.has(fixture)) {
    const b = readFileSync(`tests/fixtures/${fixture}`);
    docs.set(fixture, await importPdf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), fixture, { renderPreviews: false, reconstructTables: false }));
  }
  return docs.get(fixture)!;
}

// ---------------------------------------------------------------- (a) heuristic predictions
const DATA_ROLES = new Set<PageRole>(['spec', 'safety', 'colors', 'wheels', 'price']);
function heuristicPredict(doc: DocumentIR, pageIndex: number): { pageType: string; roles: Record<string, string> } {
  const regionsPerPage = doc.pages.map((p) => groupRegions(p, isTablePage(p) ? 'row' : 'para'));
  const isLine = (r: Region) => r.blockType === 'shape' && Math.min(r.bbox.width, r.bbox.height) <= 3;
  const pageRoles = doc.pages.map((p, pi) => classifyPage(p, regionsPerPage[pi].filter((r) => !isLine(r)), pi, doc.pages.length).role);
  let firstData = pageRoles.findIndex((r) => DATA_ROLES.has(r));
  if (firstData < 0) firstData = doc.pages.length;

  const page = doc.pages[pageIndex];
  const regions = regionsPerPage[pageIndex].filter((r) => !isLine(r));
  const role = pageRoles[pageIndex];
  const early = pageIndex < firstData;
  const largestFont = Math.max(0, ...regions.filter((r) => r.blockType === 'text').map((r) => r.maxFont));
  const roles: Record<string, string> = {};
  for (const r of regions) {
    const kind = slotKind(role, r, r.blockType === 'text' && r.maxFont === largestFont && largestFont > 0, early, page.height);
    const contract = KIND_TO_ROLE[kind];
    for (const id of r.ids) roles[id] = contract;
  }
  return { pageType: ROLE_TO_PAGE_TYPE[role], roles };
}

// ---------------------------------------------------------------- (b) AI predictions
function pageJpegViaPy(fixture: string, pageIndex: number): string {
  const out = `_sem-cache/${fixture.replace(/\.pdf$/, '')}.p${pageIndex}.jpg`;
  if (!existsSync(out)) {
    execFileSync('python3', ['-c', `
import fitz, sys
pg = fitz.open(sys.argv[1])[int(sys.argv[2])]
z = 1400 / max(pg.rect.width, pg.rect.height)
pg.get_pixmap(matrix=fitz.Matrix(z, z)).save(sys.argv[3], jpg_quality=80)
`, `tests/fixtures/${fixture}`, String(pageIndex), out]);
  }
  return readFileSync(out).toString('base64');
}

async function aiPredict(doc: DocumentIR, fixture: string, pageIndex: number, provider: GeminiSemanticProvider): Promise<{ pageType: string; roles: Record<string, string> } | null> {
  const cacheFile = `_sem-cache/${fixture.replace(/\.pdf$/, '')}.p${pageIndex}.sem.json`;
  let sem: PageSemantics;
  if (existsSync(cacheFile)) {
    sem = JSON.parse(readFileSync(cacheFile, 'utf-8'));
  } else {
    const page = doc.pages[pageIndex];
    sem = await provider.classifyPage({
      imageJpegBase64: pageJpegViaPy(fixture, pageIndex),
      blocks: buildCompactBlocks(page),
      pageWidth: Math.round(page.width),
      pageHeight: Math.round(page.height),
      brand: doc.brand,
    });
    writeFileSync(cacheFile, JSON.stringify(sem));
  }
  const roles: Record<string, string> = {};
  for (const b of sem.blocks) roles[b.id] = b.role;
  return { pageType: sem.pageType, roles };
}

// ---------------------------------------------------------------- metrics
interface Pred { pageType: string; roles: Record<string, string> }
function score(preds: (Pred | null)[], name: string) {
  let pagesOk = 0, pagesTotal = 0;
  const tp = new Map<string, number>(), fp = new Map<string, number>(), fn = new Map<string, number>();
  preds.forEach((pred, i) => {
    if (!pred) return;
    const g = golden[i];
    pagesTotal++;
    if (pred.pageType === g.pageType) pagesOk++;
    for (const [id, want] of Object.entries(g.roles)) {
      const got = pred.roles[id];
      if (got === want) tp.set(want, (tp.get(want) || 0) + 1);
      else {
        fn.set(want, (fn.get(want) || 0) + 1);
        if (got) fp.set(got, (fp.get(got) || 0) + 1);
      }
    }
  });
  const perRole: Record<string, { p: number; r: number; f1: number; support: number }> = {};
  let f1sum = 0, f1n = 0;
  for (const role of BLOCK_ROLES) {
    const t = tp.get(role) || 0, f = fp.get(role) || 0, n = fn.get(role) || 0;
    if (t + n === 0) continue; // role absent from golden
    const p = t + f ? t / (t + f) : 0;
    const r = t / (t + n);
    const f1 = p + r ? (2 * p * r) / (p + r) : 0;
    perRole[role] = { p, r, f1, support: t + n };
    f1sum += f1; f1n++;
  }
  return { name, pageAcc: pagesTotal ? pagesOk / pagesTotal : 0, pagesOk, pagesTotal, perRole, macroF1: f1n ? f1sum / f1n : 0 };
}

// ---------------------------------------------------------------- run
const apiKey = process.env.GEMINI_API_KEY || '';
const provider = apiKey ? new GeminiSemanticProvider(apiKey) : null;

const heurPreds: Pred[] = [];
const aiPreds: (Pred | null)[] = [];
for (const g of golden) {
  const doc = await docOf(g.fixture);
  heurPreds.push(heuristicPredict(doc, g.pageIndex));
  if (provider) {
    try { aiPreds.push(await aiPredict(doc, g.fixture, g.pageIndex, provider)); }
    catch (e) { console.error(`AI failed on ${g.fixture} p${g.pageIndex}: ${(e as Error).message.slice(0, 120)}`); aiPreds.push(null); }
  } else aiPreds.push(null);
  console.log(`scored ${g.fixture} p${g.pageIndex}`);
}

const heur = score(heurPreds, 'heuristics');
const ai = provider ? score(aiPreds, 'ai-semantic') : null;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const roleRows = Object.keys({ ...heur.perRole, ...(ai?.perRole || {}) }).sort();
let md = `# Semantic layer — judgment (heuristics vs AI)\n\nGolden set: ${golden.length} hand-labeled pages, ${golden.reduce((s, g) => s + Object.keys(g.roles).length, 0)} labeled blocks (tests/golden/pages.json).\nGenerated ${new Date().toISOString().slice(0, 16)}Z by scripts/semanticJudge.mts.\n\n`;
md += `| metric | heuristics | ${ai ? ai.name : 'ai (PENDING — run with GEMINI_API_KEY)'} |\n|---|---|---|\n`;
md += `| pageType accuracy | ${pct(heur.pageAcc)} (${heur.pagesOk}/${heur.pagesTotal}) | ${ai ? `${pct(ai.pageAcc)} (${ai.pagesOk}/${ai.pagesTotal})` : '—'} |\n`;
md += `| macro-F1 (block roles) | ${pct(heur.macroF1)} | ${ai ? pct(ai.macroF1) : '—'} |\n\n`;
md += `## Per-role precision / recall\n\n| role | support | heur P | heur R | AI P | AI R |\n|---|---|---|---|---|---|\n`;
for (const role of roleRows) {
  const h = heur.perRole[role];
  const a = ai?.perRole[role];
  md += `| ${role} | ${h?.support ?? a?.support ?? 0} | ${h ? pct(h.p) : '—'} | ${h ? pct(h.r) : '—'} | ${a ? pct(a.p) : '—'} | ${a ? pct(a.r) : '—'} |\n`;
}
md += `\n## Verdict\n\n`;
if (!ai) {
  md += `The AI column is PENDING (no GEMINI_API_KEY in the environment). Per the contract, the AI path becomes default ONLY if it beats the heuristics on this table — the default therefore REMAINS the heuristic learner.\n`;
} else {
  const wins = ai.pageAcc > heur.pageAcc && ai.macroF1 > heur.macroF1;
  md += wins
    ? `AI WINS (pageType ${pct(ai.pageAcc)} > ${pct(heur.pageAcc)}, macro-F1 ${pct(ai.macroF1)} > ${pct(heur.macroF1)}). Flipping the default is now justified — do it as a separate reviewed change.\n`
    : `AI DOES NOT WIN (pageType ${pct(ai.pageAcc)} vs ${pct(heur.pageAcc)}, macro-F1 ${pct(ai.macroF1)} vs ${pct(heur.macroF1)}). The heuristic learner REMAINS the default.\n`;
}
writeFileSync('docs/SEMANTIC_JUDGE.md', md);
console.log('\n' + md);
