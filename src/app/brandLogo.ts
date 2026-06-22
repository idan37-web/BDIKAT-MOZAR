// Brand logos, embedded as bundled assets (data URI in the single-file build). When the learner
// detects a "logo" slot in a template, generation drops the matching brand logo into that slot —
// so a freshly created catalog carries the right marque without manual upload.
import peugeot from '../assets/logo-peugeot.png?url';
import citroen from '../assets/logo-citroen.png?url';
import opel from '../assets/logo-opel.png?url';
import mg from '../assets/logo-mg.png?url';
import ds from '../assets/logo-ds.png?url';

const LOGO_URL: Record<string, string> = { peugeot, citroen, opel, mg, ds };

/** Bundled URL of a brand logo (usable as an <img> src). */
export function brandLogoUrl(brand?: string): string | undefined {
  return LOGO_URL[(brand || '').toLowerCase()];
}

const cache = new Map<string, string>();
/** Fetch a brand logo and return it as a data URL (needed so PDF export can embed it — the
 * exporter only embeds data URLs, not http paths). Cached per brand. */
export async function loadBrandLogoDataUrl(brand?: string): Promise<string | undefined> {
  const key = (brand || '').toLowerCase();
  const url = LOGO_URL[key];
  if (!url) return undefined;
  if (cache.has(key)) return cache.get(key);
  if (url.startsWith('data:')) { cache.set(key, url); return url; }
  const res = await fetch(url);
  const blob = await res.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  cache.set(key, data);
  return data;
}
