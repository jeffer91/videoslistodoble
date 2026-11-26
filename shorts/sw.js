'use strict';
/* Permite abrir la app sin conexión. Red primero para recibir siempre la última versión. */
const CACHE = 'shorts-11-v3';
const SHELL = ['./', './index.html', './shorts.css', './core.js', './effects.js', './store.js', './audio.js', './compose.js', './fx.js', './images.js', './whisper.js', './whisper-worker.js', './export.js', './app.js',
  './manifest.webmanifest', './vendor/mediabunny.min.mjs', './vendor/paises.json', './media/logo-11-records.png', './media/sello-vertical.png', './media/sello.wav',
  './media/icon-192.png', './media/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shorts-11-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {}); }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true })));
});
