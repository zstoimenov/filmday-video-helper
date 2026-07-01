const CACHE_NAME = 'e2a-prompter-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/parser.js',
  './js/analytics.js',
  './js/export.js',
  './js/version.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          // cache.addAll() uses the browser's default HTTP cache, which can
          // silently reuse a stale response (GitHub Pages sets Cache-Control
          // on served files) and bake old bytes into a brand-new versioned
          // cache. Force a real network fetch for every app-shell file so a
          // version bump always pulls the actual latest content.
          APP_SHELL.map((url) =>
            fetch(url, { cache: 'reload' }).then((response) => {
              if (response && response.ok) return cache.put(url, response);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
