// One-shot PWA icon generator (run manually; PNGs are committed to public/).
// Draws the AutoSpec Studio mark: dark rounded square + teal spec-sheet glyph.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

const DARK = '#1a1d23', TEAL = '#1a767b', TEAL2 = '#2a9aa0', PAPER = '#f6f8fa';

function draw(size, { maskable = false } = {}) {
  const c = createCanvas(size, size);
  const x = c.getContext('2d');
  // background (full-bleed for maskable so the safe zone isn't clipped)
  x.fillStyle = DARK;
  const r = maskable ? 0 : size * 0.22;
  roundRect(x, 0, 0, size, size, r); x.fill();
  // safe-zone scale for maskable (glyph within inner 80%)
  const pad = maskable ? size * 0.16 : size * 0.24;
  const w = size - pad * 2;
  // spec sheet (paper)
  const px = pad, py = pad, pw = w * 0.72, ph = w;
  x.fillStyle = PAPER; roundRect(x, px, py, pw, ph, size * 0.045); x.fill();
  // header band
  x.fillStyle = TEAL; roundRect(x, px, py, pw, ph * 0.2, size * 0.045); x.fill();
  x.fillRect(px, py + ph * 0.12, pw, ph * 0.08);
  // spec rows
  x.fillStyle = '#c8d0d6';
  const rows = 5, gap = ph * 0.62 / rows;
  for (let i = 0; i < rows; i++) {
    const ry = py + ph * 0.3 + i * gap;
    x.fillRect(px + pw * 0.1, ry, pw * 0.5, ph * 0.045);        // label
    x.fillStyle = TEAL2; x.fillRect(px + pw * 0.66, ry, pw * 0.22, ph * 0.045); // value
    x.fillStyle = '#c8d0d6';
  }
  // accent "check" tab overlapping bottom-right (variable/generated cue)
  x.fillStyle = TEAL2;
  const cx = px + pw * 0.86, cy = py + ph * 0.86, cr = w * 0.2;
  x.beginPath(); x.arc(cx, cy, cr, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#fff'; x.lineWidth = size * 0.035; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(cx - cr * 0.4, cy); x.lineTo(cx - cr * 0.05, cy + cr * 0.38); x.lineTo(cx + cr * 0.5, cy - cr * 0.42); x.stroke();
  return c.toBuffer('image/png');
}
function roundRect(x, X, Y, W, H, R) {
  x.beginPath();
  x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath();
}
writeFileSync('public/icon-192.png', draw(192));
writeFileSync('public/icon-512.png', draw(512));
writeFileSync('public/icon-maskable-512.png', draw(512, { maskable: true }));
console.log('icons written: 192, 512, maskable-512');
