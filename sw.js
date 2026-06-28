/**
 * sw.js — Thanzi Service Worker v4
 * Auto cache-busting on every deploy — no manual version bumps needed.
 *
 * Strategy:
 *  • APP_SHELL files → Network first, fall back to cache (always fresh)
 *  • Dynamic/CDN     → Cache first, background revalidate (stale-while-revalidate)
 *  • Live APIs       → Network only, never cached
 */

// ── Cache version — injected by deploy script, or falls back to timestamp ──
const BUILD_TS   = self.__BUILD_TS__ || Date.now();
const CACHE      = 'thanzi-shell-' + BUILD_TS;
const DYN_CACHE  = 'thanzi-dyn-v1';   // shared dynamic cache — not versioned
const SCOPE      = '/thanzi/';

const APP_SHELL = [
  '/thanzi/',
  '/thanzi/index.html',
  '/thanzi/manifest.json',
  '/thanzi/css/style.css',
  '/thanzi/css/log.css',
  '/thanzi/css/progress.css',
  '/thanzi/css/drawer.css',
  '/thanzi/css/custom-foods.css',
  '/thanzi/css/meal-templates.css',
  '/thanzi/css/exercise.css',
  '/thanzi/css/weight.css',
  '/thanzi/css/goals.css',
  '/thanzi/css/ai.css',
  '/thanzi/css/recipe.css',
  '/thanzi/css/settings.css',
  '/thanzi/js/app.js',
  '/thanzi/js/ai.js',
  '/thanzi/js/log.js',
  '/thanzi/js/progress.js',
  '/thanzi/js/drawer.js',
  '/thanzi/js/meal-templates.js',
  '/thanzi/js/exercise.js',
  '/thanzi/js/weight.js',
  '/thanzi/js/custom-foods.js',
  '/thanzi/js/settings.js',
  '/thanzi/js/goals.js',
  '/thanzi/js/recipe.js',
  '/thanzi/js/scanner.js',
  '/thanzi/js/profile.js',
  '/thanzi/js/auth.js',
  '/thanzi/js/config.js',
  '/thanzi/js/thanzi-foodSearch.js',
  '/thanzi/js/thanzi-nutrition.js',
  '/thanzi/icons/web-app-manifest-192x192.png',
  '/thanzi/icons/web-app-manifest-512x512.png',
  '/thanzi/icons/apple-touch-icon.png',
  '/thanzi/icons/favicon-96x96.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
];

// Never cache — always hit the network
const NETWORK_ONLY = [
  'appwrite.io',
  'fra.appwrite.run',
  'workers.dev',          // Malawinutrient API + Cloudflare Workers
  'api.groq.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.nal.usda.gov',
  'openfoodfacts.org',
];

// ── Install — pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache =>
        Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(e => console.warn('[SW] skip:', url, e.message))
          )
        )
      )
      // Skip waiting so the new SW activates immediately on every deploy
      .then(() => self.skipWaiting())
  );
});

// ── Activate — delete ALL old caches ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE && k !== DYN_CACHE)
          .map(k => {
            console.log('[SW] deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
      // Tell all open tabs to reload so they get the fresh SW immediately
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // 1. Live APIs — network only, never cache
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. App shell & JS/CSS — Network first, fall back to cache
  //    This means updates are always served fresh when online.
  const isAppFile = APP_SHELL.some(u => request.url.endsWith(u.replace(SCOPE, '')) || request.url === u)
    || url.pathname.match(/\.(js|css|html)$/);

  if (isAppFile) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            // Update the shell cache with the fresh response
            caches.open(CACHE).then(c => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))  // offline fallback
    );
    return;
  }

  // 3. Everything else (images, fonts, CDN) — cache first, revalidate in bg
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          caches.open(DYN_CACHE).then(c => c.put(request, response.clone()));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data
    ? event.data.json()
    : { title: 'Thanzi', body: 'You have a new update!' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Thanzi', {
      body:  data.body  || '',
      icon:  '/thanzi/icons/web-app-manifest-192x192.png',
      badge: '/thanzi/icons/favicon-96x96.png',
    })
  );
});

// ── Message from app — manual cache clear ────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    );
  }
});
