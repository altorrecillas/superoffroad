// Service worker: the game keeps working without a connection once it has been
// opened. Online it always fetches the current files (network first, so a new
// version is never hidden behind an old copy); offline it serves the saved ones.
// After the first load the page sends the list of files it used, so everything the
// game needs is saved straight away; the music is saved whole the first time it plays.

const CACHE = 'sor-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// the page: "these are the files I used, keep them"
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'cache' || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(d.urls.map(async (u) => {
      try { if (!(await cache.match(u, { ignoreSearch: true }))) await cache.add(u); } catch (err) { /* offline or gone */ }
    }));
    if (e.source) e.source.postMessage({ type: 'cached', n: d.urls.length });
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) e.respondWith(ranged(req));
  else e.respondWith(networkFirst(req, e));
});

async function networkFirst(req, e) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200 && res.type === 'basic') e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html', { ignoreSearch: true }) || await cache.match('./', { ignoreSearch: true });
      if (page) return page;
    }
    throw err;
  }
}

// media (music) asks for byte ranges: answer from the saved whole file when there is
// one, otherwise go to the network and save the whole file for next time
async function ranged(req) {
  const cache = await caches.open(CACHE);
  const key = req.url.split('#')[0];
  const full = await cache.match(key, { ignoreSearch: true });
  if (!full) {
    cache.add(key).catch(() => {});
    return fetch(req);
  }
  const buf = await full.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - +m[2]); } // bytes=-N: the last N
    else { start = +m[1] || 0; if (m[2] !== '') end = Math.min(size - 1, +m[2]); }
  }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
