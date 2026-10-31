// Offline cache for "Последний рейс"
const CACHE = 'last-flight-4aba8c6ce8';
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/favicon-64.png", "icons/icon-192.png", "icons/icon-512-maskable.png", "icons/icon-512.png", "fonts/caveat-cyrillic-600-normal.woff2", "fonts/caveat-cyrillic-700-normal.woff2", "fonts/caveat-latin-600-normal.woff2", "fonts/caveat-latin-700-normal.woff2", "fonts/rubik-cyrillic-400-normal.woff2", "fonts/rubik-cyrillic-500-normal.woff2", "fonts/rubik-cyrillic-700-normal.woff2", "fonts/rubik-latin-400-normal.woff2", "fonts/rubik-latin-500-normal.woff2", "fonts/rubik-latin-700-normal.woff2", "fonts/russo-one-cyrillic-400-normal.woff2", "fonts/russo-one-latin-400-normal.woff2"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch:true }).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.ok && new URL(e.request.url).origin === location.origin){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
  );
});
