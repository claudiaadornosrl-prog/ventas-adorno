// Service Worker — Ventas Adorno
const CACHE_VERSION = 'ventas-adorno-v21-cerrar-dia';
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

// ─── Web Push ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: 'Ventas Adorno', body: event.data?.text() || '' };
  }
  const title = data.title || 'Ventas Adorno';
  const opts = {
    body: data.body || '',
    icon: data.icon || './favicon.svg',
    badge: data.badge || './favicon.svg',
    tag: data.tag || 'ventas-default',
    data: { url: data.url || './' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification?.data?.url || './';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.registration.scope) && 'focus' in c) { return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
