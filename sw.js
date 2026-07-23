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
