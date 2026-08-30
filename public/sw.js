/*
 * オフライン用の Service Worker。
 *
 * 電波のない場所（車のなか・実家・飛行機）でも遊べることは、子ども向けでは
 * 実質的な必須要件。そこで install の時点でアプリ一式（HTML / JS / CSS /
 * アイコン / manifest）をまとめて取りにいき、2回目以降の起動はネットワークが
 * 無くても成立するようにする。
 *
 * 「一度読んだものをキャッシュに残す」方式では足りない。Service Worker は
 * 登録したページ自身の読みこみを横取りできないので、初回訪問では index.html も
 * バンドルもキャッシュに入らない。初回のあと圏外になると起動できなくなる。
 *
 * VERSION と PRECACHE はビルド時に vite.config.ts が本物の値へ書きかえる。
 * 出力ファイル名にはハッシュが付くので、ここに直接は書けない。
 */

// ↓ この 2行はビルドで置換される。置換されていない場合（public/ を直に配信した
//   ときなど）は install に失敗し、Service Worker は登録されないまま何も壊さない。
const VERSION = '__BUILD_ID__';
const PRECACHE = ['__PRECACHE__'];

const CACHE = `tj-${VERSION}`;

// PRECACHE に無いものが入ってきたときの上限。いまのアプリは外部から何も
// 取ってこないので普段は 0 件だが、際限なく増える経路を残さないための保険。
const MAX_RUNTIME = 30;

// 相対パスのままでは cache.keys() が返す絶対 URL と比べられない
const precached = new Set(PRECACHE.map((url) => new URL(url, self.location.href).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll は 1つでも失敗すると全体が失敗する。それでよい。
      // 中途半端に入った状態で activate まで進むと、後段で古いキャッシュを
      // 消してしまい「更新したら圏外で遊べなくなった」が起きる。
      // ここで失敗した新しい Service Worker は破棄され、いまのものが残る。
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 版が変わるとキャッシュ名も変わる。古い版はまとめて捨てる
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  // アプリ本体は消さない。挿入順の古いものから消す実装だと、いちばん最初に
  // 入る index.html とバンドルが真っ先に消える
  const extra = keys.filter((req) => !precached.has(req.url));
  for (let i = 0; i < extra.length - MAX_RUNTIME; i++) {
    await cache.delete(extra[i]);
  }
}

async function store(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  await trim(cache);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // HTML はネットワーク優先（更新をすぐ反映）、それ以外はキャッシュ優先（起動が速い）。
  // 出力ファイル名にハッシュが付くので、キャッシュ優先でも古い版を掴み続けることはない。
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          void store(req, res.clone());
          return res;
        } catch {
          // "/mathegame/" と "/mathegame/index.html" は別のキーになるので両方見る
          return (
            (await caches.match(req)) ||
            (await caches.match('./index.html')) ||
            (await caches.match('./')) ||
            Response.error()
          );
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
