// One-click background removal for an image block: sample the corner colour (the background)
// and make matching pixels transparent. Works on data-URL images in the browser (canvas).
export async function removeBackground(src: string, tolerance = 28): Promise<string> {
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
  // background = average of the four corners (robust to a single noisy pixel)
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]];
  });
  const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c2) => s + c2[k], 0) / corners.length));
  const tol2 = tolerance * tolerance * 3;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= tol2) d[i + 3] = 0; // within tolerance of bg → transparent
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
