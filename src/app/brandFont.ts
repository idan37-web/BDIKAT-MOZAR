// Brand fonts. Imported as URLs so they bundle in dev/build AND inline (data URI) in
// the single-file build — never fetched from a path that won't exist offline.
// Imported text must never use fontFamily:inherit; it gets the brand font.
import peugeotRegular from '../assets/PeugeotNewHebrew-Regular.otf?url';
import peugeotBold from '../assets/PeugeotNewHebrew-Bold.otf?url';
import citroenRegular from '../assets/CitroenTypeHebrew-Regular.ttf?url';
import citroenBold from '../assets/CitroenTypeHebrew-Bold.ttf?url';
import almoniBold from '../assets/AlmoniNeue-Bold.otf?url';
import opelRegular from '../assets/OpelNextHebrew-Regular.otf?url';
import opelBold from '../assets/OpelNextHebrew-Bold.otf?url';

export interface BrandFont {
  brand: string;
  family: string;          // CSS font-family to apply
  regularUrl: string;      // for @font-face + pdf-lib embedding
  boldUrl?: string;
}

const PEUGEOT: BrandFont = { brand: 'peugeot', family: 'PeugeotNewHebrew', regularUrl: peugeotRegular, boldUrl: peugeotBold };
const CITROEN: BrandFont = { brand: 'citroen', family: 'CitroenTypeHebrew', regularUrl: citroenRegular, boldUrl: citroenBold };
// MG supplied only Almoni Neue Bold (Hebrew+Latin); used for both weights until a regular arrives.
const MG: BrandFont = { brand: 'mg', family: 'AlmoniNeue', regularUrl: almoniBold, boldUrl: almoniBold };
const OPEL: BrandFont = { brand: 'opel', family: 'OpelNextHebrew', regularUrl: opelRegular, boldUrl: opelBold };

/** Detect the brand from the source filename (extend per brand as fonts arrive). */
export function detectBrand(name?: string): string {
  const n = (name || '').toLowerCase();
  if (/peugeot|208|2008|3008|5008|rifter|boxer/.test(n)) return 'peugeot';
  if (/citroen|citroën|c3|c4|c5|berlingo|jumpy/.test(n)) return 'citroen';
  if (/opel|corsa|astra|mokka|grandland|crossland|combo|zafira|insignia|vivaro|frontera/.test(n)) return 'opel';
  if (/\bmg(s\d|[_\s-](hs|zs|ehs|phev)|\d)/i.test(n) || /\bmg\b/i.test(n)) return 'mg';
  return 'unknown';
}

export function brandFont(brand: string): BrandFont | null {
  if (brand === 'peugeot') return PEUGEOT;
  if (brand === 'citroen') return CITROEN;
  if (brand === 'mg') return MG;
  if (brand === 'opel') return OPEL;
  return null; // other brands fall back to a Hebrew system stack until a font is supplied
}

const injected = new Set<string>();
/** Inject an @font-face once so the DOM editor renders in the brand font. */
export function ensureFontFace(bf: BrandFont): void {
  if (injected.has(bf.family)) return;
  injected.add(bf.family);
  const css = `@font-face{font-family:'${bf.family}';src:url('${bf.regularUrl}');font-weight:400;font-display:swap;}`
    + (bf.boldUrl ? `@font-face{font-family:'${bf.family}';src:url('${bf.boldUrl}');font-weight:700;font-display:swap;}` : '');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

export const FALLBACK_HEBREW = "'Assistant','Heebo',system-ui,sans-serif";

/**
 * Load the actual font bytes to EMBED on export. Brand font when available, else the
 * Peugeot Hebrew OTF as a generic Hebrew-capable embed (Citroën font was never supplied;
 * the editor still shows the system stack, but a PDF needs real embedded glyphs). Works
 * with the bundled `?url` asset in dev, build, and the single-file (data-URI) build.
 */
export async function loadExportFont(brand: string): Promise<Uint8Array> {
  const bf = brandFont(brand);
  const url = bf?.regularUrl || peugeotRegular;
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

/** Load BOTH weights to embed on export, so bold text/headings render bold (not faux). */
export async function loadExportFonts(brand: string): Promise<{ regular: Uint8Array; bold?: Uint8Array }> {
  const bf = brandFont(brand);
  const regUrl = bf?.regularUrl || peugeotRegular;
  const boldUrl = bf?.boldUrl || peugeotBold;
  const fetchBytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const regular = await fetchBytes(regUrl);
  let bold: Uint8Array | undefined;
  try { bold = await fetchBytes(boldUrl); } catch { bold = undefined; }
  return { regular, bold };
}
