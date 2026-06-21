// Minimal .xlsx WRITER (STORE / no compression → no CompressionStream needed, browser-safe),
// used to hand the user a downloadable template in THEIR natural multi-sheet format
// (one tab per category). Inline strings keep it dependency-free.
import type { NamedSheet } from './parseSheet';

const enc = new TextEncoder();

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const u16 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255]);
const u32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
function cat(parts: Uint8Array[]): Uint8Array { const len = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const xesc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

function colRef(i: number): string { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function sheetXml(cells: string[][]): string {
  let rows = '';
  cells.forEach((row, r) => {
    let cs = '';
    row.forEach((v, c) => { if (v == null || v === '') return; cs += `<c r="${colRef(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xesc(String(v))}</t></is></c>`; });
    rows += `<row r="${r + 1}">${cs}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

/** Build a STORE-only .xlsx from named sheets. */
export function writeXlsx(sheets: NamedSheet[]): Uint8Array {
  const parts: { name: string; data: Uint8Array }[] = [];
  const sheetXmls = sheets.map((s) => sheetXml(s.cells));
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  parts.push({ name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`) });
  parts.push({ name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) });
  const sheetTags = sheets.map((s, i) => `<sheet name="${xesc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  parts.push({ name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`) });
  const wbRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  parts.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>`) });
  sheetXmls.forEach((x, i) => parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(x) }));

  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = []; let offset = 0;
  for (const p of parts) {
    const name = enc.encode(p.name); const crc = crc32(p.data); const sz = p.data.length;
    const local = cat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), name, p.data]);
    locals.push(local);
    centrals.push(cat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const cd = cat(centrals);
  const eocd = cat([u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length), u32(cd.length), u32(offset), u16(0)]);
  return cat([...locals, cd, eocd]);
}
