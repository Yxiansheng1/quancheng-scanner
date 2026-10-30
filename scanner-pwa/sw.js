/* 离线缓存：把整个应用外壳存下来，断网也能用 */
const CACHE = 'scanner-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './scan.js',
  './pdf.js',
  './idb.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    caches.match(ev.request).then((cached) => {
      if (cached) return cached;
      return fetch(ev.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(ev.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
