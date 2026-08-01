# SSIM between two same-size images (PNG paths) — pilot judgment metric.
# Standard SSIM (Wang et al.) on grayscale with an 8x8 box filter (cumsum-based, no scipy).
import sys
import fitz
import numpy as np


def load_gray(path: str) -> np.ndarray:
    pix = fitz.Pixmap(path)
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)  # drop alpha
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n >= 3:
        g = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    else:
        g = arr[:, :, 0].astype(np.float64)
    return g.astype(np.float64)


def box(img: np.ndarray, k: int) -> np.ndarray:
    """k x k box mean via integral image."""
    pad = np.pad(img, ((1, 0), (1, 0)))
    ii = pad.cumsum(0).cumsum(1)
    h, w = img.shape
    ys = np.arange(h - k + 1)
    xs = np.arange(w - k + 1)
    s = ii[ys[:, None] + k, xs[None, :] + k] - ii[ys[:, None], xs[None, :] + k] \
        - ii[ys[:, None] + k, xs[None, :]] + ii[ys[:, None], xs[None, :]]
    return s / (k * k)


def ssim(a: np.ndarray, b: np.ndarray, k: int = 8) -> float:
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a, mu_b = box(a, k), box(b, k)
    aa, bb, ab = box(a * a, k), box(b * b, k), box(a * b, k)
    va, vb = aa - mu_a ** 2, bb - mu_b ** 2
    cov = ab - mu_a * mu_b
    s = ((2 * mu_a * mu_b + C1) * (2 * cov + C2)) / ((mu_a ** 2 + mu_b ** 2 + C1) * (va + vb + C2))
    return float(s.mean())


if __name__ == '__main__':
    a = load_gray(sys.argv[1])
    b = load_gray(sys.argv[2])
    h = min(a.shape[0], b.shape[0])
    w = min(a.shape[1], b.shape[1])
    print(round(ssim(a[:h, :w], b[:h, :w]), 4))
