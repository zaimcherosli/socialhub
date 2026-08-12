// SocialHub Service Worker — v1.4.96
// CACHE_NAME is tied to version so old caches auto-purge on every deployment
const SW_VERSION = '1.4.96';
const CACHE_NAME = `socialhub-cache-v${SW_VERSION}`;
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
  console.log(`[SW] Installing v${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell assets');
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => {
          // Use cache: 'no-store' to bypass HTTP cache when pre-caching
          return cache.add(new Request(url, { cache: 'no-store' }))
            .catch(err => console.warn(`[SW] Failed to cache: ${url}`, err));
        })
      );
    })
  );
  // Force immediate activation
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating v${SW_VERSION}`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete ALL caches that don't match our current version
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Purging old cache: ${cacheName}`);
            return caches.delete(cacheName);
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

  const url = new URL(event.request.url);
  const isHtmlRequest = event.request.headers && event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');
  const isJsOrCss = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
  const isImage = url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i);

  if (isHtmlRequest || isJsOrCss) {
    // ══════════════════════════════════════════════════════════════════════
    // Network-First strategy for HTML + JS + CSS
    // CRITICAL: { cache: 'no-store' } forces the fetch to bypass the
    // browser's HTTP cache entirely. Without this, even "Network-First"
    // actually hits the HTTP cache first (which may return stale content
    // if Cache-Control max-age hasn't expired).
    // ══════════════════════════════════════════════════════════════════════
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Network failed — fall back to SW cache (offline support)
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (isHtmlRequest) {
              return new Response(OFFLINE_PAGE_HTML, {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
              });
            }
            return new Response('Asset unavailable offline', { status: 404, statusText: 'Offline' });
          });
        })
    );
  } else if (isImage) {
    // Cache-First strategy for images (rarely change, safe to cache)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        }).catch(() => {
          return new Response('Image unavailable offline', { status: 404, statusText: 'Offline' });
        });
      })
    );
  }
  // All other requests (API calls, fonts, etc.) — pass through without SW interception
});


// Receive SKIP_WAITING command from the app when user approves the update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — activating new version now');
    self.skipWaiting();
  }
});
