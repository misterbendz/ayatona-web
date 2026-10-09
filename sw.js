// Service worker for the installed web app (PWA): the app opens fast and works offline once
// visited. Large media (background videos, the speech model, recitations) and anything from
// other sites are left to the network and the browser's own cache.
const VERSION = 'ayatona-v2';
/** Built files carry a hash; keep only the most recent ones so the cache cannot grow forever. */
const MAX_ASSETS = 60;
const SHELL = ['./', 'index.html', 'icon.png', 'manifest.webmanifest', 'fonts/splash/aref-ruqaa-700.woff2', 'fonts/splash/cairo-400.woff2', 'fonts/splash/cairo-600.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Never cached here: large or streamed files. */
const SKIP = /\/(backgrounds|models|audio|_promo)\//;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;

  // Pages: the network first (to get updates), the saved copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // only the app's own page, and only when it loaded properly (never a 404 or 5xx page)
          const path = new URL(res.url || req.url).pathname;
          if (res.ok && (path.endsWith('/') || path.endsWith('/index.html'))) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('index.html').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Built assets carry a hash in their name and never change: the saved copy first.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy).then(() => trimAssets(c)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The news list behind the bell: the network first, so new updates show at once.
  if (url.pathname.endsWith('/updates.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Fonts, Quran text and icons: answer from the saved copy, refresh it in the background.
  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit || Response.error());
        return hit || fresh;
      }),
    ),
  );
});

/** Drops the oldest built files beyond MAX_ASSETS (the cache lists entries in the order they were added). */
async function trimAssets(cache) {
  const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.includes('/assets/'));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}
