// Service Worker — Ventas Adorno
const CACHE_VERSION = 'ventas-adorno-v12-bloqueo-edicion-y-correcciones';
const CACHE_ASSETS = ['./', './index.html', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(CACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Network-first: si falla la red, fallback a cache
  e.respondWith(
    fetch(req).then(r => {
      if (r && r.ok && new URL(req.url).origin === location.origin) {
        const clone = r.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, clone));
      }
      return r;
    }).catch(() => caches.match(req))
  );
});
