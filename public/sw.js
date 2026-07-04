/*
 * AutoSpec Studio — service worker (Stage 9 / C.10: PWA + offline app shell).
 *
 * Strategy (dependency-free, no build-time precache manifest needed — Vite emits
 * content-hashed, immutable asset names we can't know here):
 *   - navigations (HTML)      → network-first, fall back to the cached shell (index.html)
 *   - same-origin GET assets  → stale-while-revalidate (hashed => safe to serve from cache
 *                               and refresh in the background)
 *   - cross-origin            → passthrough (the app ships all fonts/assets same-origin; there is no CDN)
 *
 * After one full online load, everything the app fetched (JS, CSS, fonts, the pdf.js
 * worker once a PDF is parsed) is cached, so the app opens offline. Bump CACHE_VERSION
 * to invalidate old caches on deploy.
 */
const CACHE_VERSION = 'autospec-v1';
// The built, content-hashed asset list is injected here at build time by
// scripts/injectPrecache.mjs (`vite build` → inject). Falls back to the bare
// shell if the injection step didn't run (e.g. `vite dev`, which never registers a SW).
const PRECACHE = ['./', './index.html', './manifest.webmanifest']; /* __PRECACHE__ */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // Precache each URL individually so one failure can't abort the whole set.
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((res) => (res && res.ok ? cache.put(url, res) : undefined))
            .catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(request, url) {
  return (
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    !url.pathname.endsWith('/sw.js')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // App navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(request).then((m) => m || caches.match('./index.html'))),
    );
    return;
  }

  if (!isCacheableAsset(request, url)) return; // let the browser handle it

  // Assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type !== 'opaque') cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    ),
  );
});
