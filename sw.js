/**
 * sw.js — Thanzi Service Worker v3
 * Vanilla JS — no build tools required
 */

const CACHE      = 'thanzi-v4';
const DYN_CACHE  = 'thanzi-dyn-v4';
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
  '/thanzi/settings.css',
  '/thanzi/js/app.js',
  '/thanzi/js/ai.js',
  '/thanzi/js/progress.js',
  '/thanzi/js/drawer.js',
  '/thanzi/js/meal-templates.js',
  '/thanzi/js/exercise.js',
  '/thanzi/js/weight.js',
  '/thanzi/js/custom-foods.js',
  '/thanzi/settings.js',
  '/thanzi/icons/web-app-manifest-192x192.png',
  '/thanzi/icons/web-app-manifest-512x512.png',
  '/thanzi/icons/apple-touch-icon.png',
  '/thanzi/icons/favicon-96x96.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
];

// Never cache these — must always be live
const NETWORK_ONLY = [
  'appwrite.io',
  'fra.appwrite.run',
  'workers.dev',
  'api.groq.com',
  'api.openai.com',
  'api.anthropic.com',
  'api.nal.usda.gov',
  'openfoodfacts.org',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(APP_SHELL.map(url =>
        cache.add(url).catch(e => console.warn('[SW] skip:', url, e.message))
      ))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== DYN_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // Network only for live APIs
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache first for app shell
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          caches.open(DYN_CACHE).then(c => c.put(request, response.clone()));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/thanzi/index.html');
        }
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Thanzi', body: 'New update!' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Thanzi', {
      body: data.body || '',
      icon: '/thanzi/icons/web-app-manifest-192x192.png',
      badge: '/thanzi/icons/favicon-96x96.png',
    })
  );
});
