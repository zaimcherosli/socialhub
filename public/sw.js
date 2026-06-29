const CACHE_NAME = 'socialhub-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/dashboard.html',
  '/posts.html',
  '/calendar.html',
  '/ai-generate.html',
  '/accounts.html',
  '/login.html',
  '/register.html',
  '/css/variables.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/socialhub_pwa_icon.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests to local origin
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Fallback for offline HTML page routing
        if (event.request.headers && event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/dashboard.html');
        }
      });
    })
  );
});
