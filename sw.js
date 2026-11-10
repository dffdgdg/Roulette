// Service worker: после первой загрузки сайт открывается без сети.
// Стратегия: сначала сеть (чтобы обновления доезжали), при её отсутствии — кэш.
const CACHE = 'wheel-static-v1';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/state.js',
  'js/storage.js',
  'js/wheel.js',
  'js/audio.js',
  'js/media.js',
  'js/ui.js',
  'js/confetti.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
