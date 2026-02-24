/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Service Worker
   Basic caching for PWA offline support
   ═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'stammbaum-v23';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/db.js',
  '/js/auth.js',
  '/js/relationship.js',
  '/js/tree.js',
  '/js/qr.js',
  '/js/search.js',
  '/js/admin.js',
  '/js/claim.js',
  '/js/connection.js',
  '/js/relations.js',
  '/js/profile.js',
  '/js/app.js',
  '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('SW: Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Supabase API requests: network only (never cache)
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // CDN resources (unpkg, etc): cache first
  if (url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
