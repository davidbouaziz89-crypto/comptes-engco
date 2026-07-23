/* ProFormationPlus — Service Worker (réseau d'abord, cache de secours hors-ligne) */
const CACHE = 'pfp-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---- Notifications push ---- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'ProFormationPlus';
  const opts = {
    body: d.body || '',
    icon: d.icon || '/icons/portal-192.png',
    badge: d.badge || '/icons/portal-192.png',
    data: { url: d.url || '/' },
    tag: d.tag || undefined,
    renotify: !!d.tag,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // laisse passer POST/PUT (Supabase, uploads)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // ne gère que le même domaine (pas Supabase/CDN)

  e.respondWith((async () => {
    try {
      const res = await fetch(req);                  // réseau d'abord → toujours la dernière version en ligne
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);        // hors-ligne → cache
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const home = await caches.match('/index.html') || await caches.match('/');
        if (home) return home;
      }
      throw err;
    }
  })());
});
