// Milestone D — raw spreadsheet parsing (no external deps; single-file-build safe).
// Excel "Save As CSV"/"CSV UTF-8" is the guaranteed path; .xlsx is supported best-effort.
// Output is always a rectangular-ish string[][] (rows of cell strings) for the adapter.

export type Cells = string[][];

const STRIP_BOM = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** Pick the delimiter Excel most likely used (comma / tab / semicolon). */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 };
  let inQuotes = false;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

/** RFC-4180-ish CSV/TSV parser: quotes, escaped "", CRLF, embedded newlines, BOM. */
export function parseDelimited(raw: string, delimiter?: string): Cells {
  const text = STRIP_BOM(raw);
  const delim = delimiter || detectDelimiter(text);
  const rows: Cells = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delim) { pushField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  // flush trailing field/row (unless the file ended on a clean newline with nothing pending)
  if (field !== '' || row.length) { pushField(); pushRow(); }
  // drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/** Serialise cells back to CSV (UTF-8 with BOM for Excel Hebrew). */
export function toCSV(cells: Cells): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + cells.map((r) => r.map((c) => esc(c ?? '')).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// .xlsx (best-effort, zero-dependency). An .xlsx is a ZIP of XML parts. We inflate
// the worksheet + sharedStrings with the platform DecompressionStream (browser) or
// node:zlib (gate), then read cell text. If anything is unsupported we throw a clear
// error and the UI tells the user to export CSV instead (the guaranteed path).
// ---------------------------------------------------------------------------

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // Browser / modern runtimes: DecompressionStream('deflate-raw').
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (typeof DS === 'function') {
    const ds = new DS('deflate-raw');
    const stream = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds));
    return new Uint8Array(await stream.arrayBuffer());
  }
  // Node (gate): zlib.inflateRawSync.
  const req = (globalThis as { require?: (m: string) => unknown }).require;
  if (req) {
    const zlib = req('node:zlib') as { inflateRawSync: (b: Uint8Array) => Uint8Array };
    return new Uint8Array(zlib.inflateRawSync(bytes));
  }
  throw new Error('no inflate available');
}

interface ZipEntry { name: string; data: Uint8Array; }

/** Minimal ZIP reader: walk local file headers, inflate (method 8) or store (0). */
async function readZip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder('utf-8');
  let i = 0;
  while (i + 4 <= buf.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const compSize = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const nameStart = i + 30;
    const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const entry: ZipEntry = { name, data: method === 0 ? comp : await inflateRaw(comp) };
    out.set(entry.name, entry.data);
    i = dataStart + compSize;
    if (compSize === 0 && method !== 0) break; // streamed (data-descriptor) — unsupported
  }
  if (!out.size) throw new Error('not a readable .xlsx (zip)');
  return out;
}

function decodeText(b?: Uint8Array): string { return b ? new TextDecoder('utf-8').decode(b) : ''; }

/** Pull <t> text values out of sharedStrings.xml in order. */
function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  // each <si> may contain one or several <t> runs (rich text) — concatenate runs.
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    let s = '';
    while ((t = tRe.exec(m[1]))) s += xmlUnescape(t[1]);
    out.push(s);
  }
  return out;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
}

function colToIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse the first worksheet's rows into Cells, resolving shared strings. */
function parseSheetXml(xml: string, shared: string[]): Cells {
  const rows: Cells = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] ?? cm[3] ?? '';
      const body = cm[2] ?? '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const col = refM ? colToIndex(refM[1]) : cells.length;
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : 'n';
      let val = '';
      if (type === 'inlineStr') {
        const tM = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(body);
        val = tM ? xmlUnescape(tM[1]) : '';
      } else {
        const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const raw = vM ? vM[1] : '';
        val = type === 's' ? (shared[+raw] ?? '') : xmlUnescape(raw);
      }
      while (cells.length < col) cells.push('');
      cells[col] = val;
    }
    rows.push(cells);
  }
  while (rows.length && rows[rows.length - 1].every((c) => (c ?? '').trim() === '')) rows.pop();
  return rows;
}

/** Read EVERY worksheet of an .xlsx into Cells (rows concatenated across sheets, so a tagged
 * row is found no matter which sheet it lives in — e.g. an "equipment" sheet alongside "spec"). */
export async function parseXlsx(bytes: Uint8Array): Promise<Cells> {
  const files = await readZip(bytes);
  const shared = parseSharedStrings(decodeText(files.get('xl/sharedStrings.xml')));
  const sheetNames = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)?.[1] || '0') - parseInt(b.match(/(\d+)/)?.[1] || '0')));
  if (!sheetNames.length) throw new Error('no worksheet found in .xlsx');
  const out: Cells = [];
  for (const name of sheetNames) {
    const rows = parseSheetXml(decodeText(files.get(name)), shared);
    if (out.length && rows.length) out.push([]); // blank separator row between sheets
    for (const r of rows) out.push(r);
  }
  return out;
}

/** Dispatch by file name/bytes: .xlsx (PK zip) vs delimited text. */
export async function parseSpreadsheet(name: string, data: ArrayBuffer | Uint8Array | string): Promise<Cells> {
  if (typeof data === 'string') return parseDelimited(data);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (/\.xlsx$/i.test(name) || isZip) return parseXlsx(bytes);
  return parseDelimited(new TextDecoder('utf-8').decode(bytes));
}
