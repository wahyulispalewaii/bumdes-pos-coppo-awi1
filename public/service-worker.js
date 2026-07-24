const CACHE = 'bumdes-pos-shell-v3-relaxed-login';
const APP_SHELL = [
  '/', '/index.html', '/assets/css/app.css', '/assets/js/app.js', '/assets/js/api.js', '/assets/js/utils.js',
  '/assets/img/logo-bumdes.webp', '/assets/img/logo-bumdes-small.webp', '/assets/img/favicon.png'
];
self.addEventListener('install', (event) => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))); });
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))])));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const clone = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, clone));
    return response;
  }).catch(() => caches.match('/'))));
});
