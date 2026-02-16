// ===== Service Worker for Brush Color for Kids =====

const CACHE_NAME = 'brushcolor-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/apple-touch-icon.png',
  './assets/GOAT.png',
  './assets/casau.jpg',
  './assets/seaanimals.jpg',
  './assets/policecar.jpg',
  './assets/firetruck.jpg',
  './assets/excavador.jpg',
  './assets/butterfly.jpg',
  './assets/dinasor.jpg',
  './assets/0ctopus.jpg',
  './assets/crab.jpg',
  './assets/orca.jpg',
  './assets/elephant.jpg',
  './assets/lion.jpg',
  './assets/turtle.jpg',
];

// Install: cache all static assets
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
