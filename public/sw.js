const CACHE_NAME = 'socialhub-cache-v23';
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

const OFFLINE_PAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline | SocialHub</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f3f4f6;
            color: #1f2937;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
            padding: 1rem;
        }
        .container {
            background: white;
            padding: 2.5rem;
            border-radius: 16px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.05);
            max-width: 400px;
        }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        p { color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }
        .btn {
            background: #2563eb;
            color: white;
            text-decoration: none;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            display: inline-block;
            transition: background 0.2s;
        }
        .btn:hover { background: #1d4ed8; }
    </style>
</head>
<body>
    <div class="container">
        <div style="font-size: 3rem; margin-bottom: 1rem;">📡</div>
        <h1>Connection Down</h1>
        <p>It seems you lost your internet connection or the server is temporarily down. Please check your network and try again.</p>
        <a href="javascript:window.location.reload();" class="btn">Retry Connection</a>
    </div>
</body>
</html>
`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      // Use silent cache addition so a single failed resource doesn't abort the entire install phase
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => {
          return cache.add(url).catch(err => console.warn(`[SW] Failed to cache resource: ${url}`, err));
        })
      );
    })
  );
  // Do NOT call skipWaiting() here — wait for app to signal SKIP_WAITING
  // so the in-app update toast can control when to activate the new SW.
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
  // Only intercept GET requests to local origin
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const isHtmlRequest = event.request.headers && event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');

  if (isHtmlRequest) {
    // Network-first strategy for navigation
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // If network failed, look for cache matches
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            // If even cache is missing, return fallback page
            return new Response(OFFLINE_PAGE_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html' }
            });
          });
        })
    );
  } else {
    // Cache-first strategy for static assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        }).catch(() => {
          // Return default failure response without causing ERR_FAILED
          return new Response('Asset unavailable offline', { status: 404, statusText: 'Offline' });
        });
      })
    );
  }
});

// Receive SKIP_WAITING command from the app when user approves the update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] SKIP_WAITING received — activating new version now');
    self.skipWaiting();
  }
});
