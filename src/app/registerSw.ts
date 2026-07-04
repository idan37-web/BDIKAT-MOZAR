// Stage 9 (C.10): register the service worker for offline / installable PWA use.
//
// Guards:
//  - only in a production build (dev uses Vite HMR; a SW would cache stale modules),
//  - only over http/https — the single-file `dist-single/index.html` opens via file://,
//    where service workers are unavailable and already fully offline (everything inlined).
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;

  window.addEventListener('load', () => {
    // Register relative to the document base so it works under any deploy sub-path.
    const base = import.meta.env.BASE_URL || './';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}
