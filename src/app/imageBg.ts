// One-click background removal for an image block. The background is removed by FLOOD-FILLING
// inward from the image edges: only background-coloured pixels that are CONNECTED to the border
// are cleared, so interior regions that happen to match the background (a white car body, window
// glass, a logo's inner counters) stay opaque. A 1px feather softens the cut edge. Browser/canvas.
export async function removeBackground(src: string, tolerance = 40): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return src;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, w, h); } catch { return src; }
  const d = data.data;

  // background reference = average of ALL border pixels (robust to a single noisy corner)
  let R = 0, G = 0, B = 0, bn = 0;
  const addBorder = (x: number, y: number) => { const i = (y * w + x) * 4; R += d[i]; G += d[i + 1]; B += d[i + 2]; bn++; };
  for (let x = 0; x < w; x++) { addBorder(x, 0); addBorder(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { addBorder(0, y); addBorder(w - 1, y); }
  const bg = [R / bn, G / bn, B / bn];
  const tol2 = tolerance * tolerance * 3;
  const isBg = (p: number) => {
    const i = p * 4; const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= tol2;
  };

  // flood fill from every border pixel that matches the background; clear only connected pixels
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number) => { const p = y * w + x; if (!seen[p] && isBg(p)) { seen[p] = 1; d[p * 4 + 3] = 0; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) { const q = p - 1; if (!seen[q] && isBg(q)) { seen[q] = 1; d[q * 4 + 3] = 0; stack.push(q); } }
    if (x < w - 1) { const q = p + 1; if (!seen[q] && isBg(q)) { seen[q] = 1; d[q * 4 + 3] = 0; stack.push(q); } }
    if (y > 0) { const q = p - w; if (!seen[q] && isBg(q)) { seen[q] = 1; d[q * 4 + 3] = 0; stack.push(q); } }
    if (y < h - 1) { const q = p + w; if (!seen[q] && isBg(q)) { seen[q] = 1; d[q * 4 + 3] = 0; stack.push(q); } }
  }

  // feather: opaque pixels touching a cleared pixel get partial alpha by closeness to bg → softer edge
  const tolFeather2 = (tolerance * 1.8) * (tolerance * 1.8) * 3;
  const touchesCleared = (x: number, y: number) =>
    (x > 0 && seen[y * w + x - 1]) || (x < w - 1 && seen[y * w + x + 1]) ||
    (y > 0 && seen[(y - 1) * w + x]) || (y < h - 1 && seen[(y + 1) * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (seen[p]) continue;
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      if (!touchesCleared(x, y)) continue;
      const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
      const dist2 = dr * dr + dg * dg + db * db;
      if (dist2 < tolFeather2) d[i + 3] = Math.round(255 * Math.min(1, dist2 / tolFeather2));
    }
  }

  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
