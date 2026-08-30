/*
 * オフライン用の Service Worker。
 * ビルドごとにファイル名にハッシュが付くので、事前リストは持たず「一度読んだものは
 * キャッシュに残す」方式にする。電波のない場所（車内・実家）でも遊べることは、
 * 子ども向けでは実質的な必須要件。
 */

const CACHE = 'tj-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function store(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // HTML はネットワーク優先（更新をすぐ反映）、それ以外はキャッシュ優先（起動が速い）
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          void store(req, res.clone());
          return res;
        } catch {
          return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      void store(req, res.clone());
      return res;
    })(),
  );
});
