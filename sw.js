/**
 * sw.js — Thanzi Service Worker
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS, icons) → Cache First
 *   - Appwrite API calls                → Network Only  (auth/data must be live)
 *   - Groq / AI proxy calls            → Network Only  (AI must be live)
 *   - USDA FDC / Open Food Facts       → Network First, fallback to cache
 *   - Chart.js CDN                     → Cache First (versioned URL, safe to cache)
 */

const CACHE_NAME    = 'thanzi-v1';
const DYNAMIC_CACHE = 'thanzi-dynamic-v1';

// ── App shell — cached on install ────────────────────────────────────────────
const APP_SHELL = [
  '/',
  '/index.html',

  // CSS
  '/css/style.css',
  '/css/log.css',
  '/css/progress.css',
  '/css/drawer.css',
  '/css/custom-foods.css',
  '/css/meal-templates.css',
  '/css/exercise.css',
  '/css/weight.css',
  '/css/goals.css',
  '/css/ai.css',
  '/settings.css',

  // JS
  '/js/progress.js',
  '/js/drawer.js',
  '/js/ai.js',
  '/js/app.js',
  '/js/meal-templates.js',
  '/js/exercise.js',
  '/js/weight.js',
  '/js/custom-foods.js',
  '/settings.js',

  // Icons
  '/icons/icon-192.png',
  '/icons/icon-512.png',

  // Manifest
  '/manifest.json',

  // Chart.js (versioned CDN — safe to cache forever)
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
];

// ── Hosts that must NEVER be served from cache ────────────────────────────────
const NETWORK_ONLY_HOSTS = [
  'appwrite.io',                          // Appwrite auth + database
  'fra.appwrite.run',                     // Appwrite Functions
  'workers.dev',                          // Thanzi AI proxy (Cloudflare)
  'api.groq.com',                         // Groq (direct, fallback)
  'api.openai.com',
  'api.anthropic.com',
];

// ── Install — pre-cache app shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      // Use individual adds so one failure doesn't block the whole shell
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Failed to cache:', url, err.message)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate — clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DYNAMIC_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — routing logic ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) return;

  // 1. Network Only — live APIs
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Cache First — app shell assets
  if (_isAppShell(url)) {
    event.respondWith(_cacheFirst(request));
    return;
  }

  // 3. Network First with dynamic cache — external food APIs (FDC, OFF)
  if (_isFoodAPI(url)) {
    event.respondWith(_networkFirst(request));
    return;
  }

  // 4. Default — Cache First for everything else (same origin)
  if (url.origin === self.location.origin) {
    event.respondWith(_cacheFirst(request));
    return;
  }
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function _cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return _offlineFallback(request);
  }
}

async function _networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || _offlineFallback(request);
  }
}

function _offlineFallback(request) {
  // For navigation requests, return the cached index.html
  if (request.mode === 'navigate') {
    return caches.match('/index.html');
  }
  // For API requests, return a JSON offline error
  if (request.headers.get('accept')?.includes('application/json')) {
    return new Response(
      JSON.stringify({ error: 'You are offline. Please check your connection.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response('Offline', { status: 503 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isAppShell(url) {
  const sameOrigin = url.origin === self.location.origin;
  const isCDN      = url.hostname === 'cdn.jsdelivr.net';
  return sameOrigin || isCDN;
}

function _isFoodAPI(url) {
  return (
    url.hostname.includes('api.nal.usda.gov') ||     // USDA FDC
    url.hostname.includes('openfoodfacts.org')        // Open Food Facts
  );
}

// ── Background sync (future: queue failed log saves) ─────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-food-logs') {
    event.waitUntil(_syncFoodLogs());
  }
});

async function _syncFoodLogs() {
  // Placeholder — implement queue from IndexedDB when offline logging is added
  console.log('[SW] Background sync: food logs');
}
