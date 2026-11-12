// Offline support: after the first visit the whole app (including pdf.js) works with no network.
// Same-origin GET requests only; Firebase calls are never cached.
const CACHE = 'underwriters-eye-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      const files = ['/', '/index.html'];
      try {
        const manifest = await (await fetch('/asset-manifest.json')).json();
        for (const entry of Object.values(manifest)) {
          files.push(`/${entry.file}`, ...[...(entry.css ?? []), ...(entry.assets ?? [])].map((f) => `/${f}`));
        }
      } catch {
        /* development build: no manifest */
      }
      await c.addAll([...new Set(files)]);
    }),
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreVary: true }).then((hit) => hit || caches.match('/index.html'))),
  );
});
