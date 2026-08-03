/**
 * sw.js — Thanzi Service Worker v4
 * Auto cache-busting on every deploy — no manual version bumps needed.
 *
 * Strategy:
 *  • APP_SHELL files → Network first, fall back to cache (always fresh)
 *  • Dynamic/CDN     → Cache first, background revalidate (stale-while-revalidate)
 *  • Live APIs       → Network only, never cached
 */

// Needed for the pushsubscriptionchange background-resync fix below —
// gives this SW access to THANZI_CONFIG.endpoint/projectId/etc.
importScripts('./js/config.js');

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
  '/thanzi/js/push.js',
  '/thanzi/js/goals.js',
  '/thanzi/js/recipe.js',
  '/thanzi/js/scanner.js',
  '/thanzi/js/profile.js',
  '/thanzi/js/auth.js',
  '/thanzi/js/config.js',
  '/thanzi/js/thanzi-foodSearch.js',
  '/thanzi/js/thanzi-nutrition.js',
  '/thanzi/icons/web-app-manifest-192x192.png',
  '/thanzi/icons/web-app-manifest-192x192-maskable.png',
  '/thanzi/icons/web-app-manifest-512x512.png',
  '/thanzi/icons/web-app-manifest-512x512-maskable.png',
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
      fetch(request, { cache: 'no-store' })
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
// Payload shape sent by the push-scheduler Cloudflare Worker:
//   { title, body, tag, url, renotify }
self.addEventListener('push', event => {
  let data = { title: 'Thanzi', body: 'You have a new update!' };
  if (event.data) {
    try { data = event.data.json(); }
    catch (e) { data = { title: 'Thanzi', body: event.data.text() }; }
  }

  const options = {
    body:     data.body || '',
    icon:     '/thanzi/icons/web-app-manifest-192x192.png',
    badge:    '/thanzi/icons/favicon-96x96.png',
    tag:      data.tag || 'thanzi-notification',
    renotify: !!data.tag,
    data:     { url: data.url || '/thanzi/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Thanzi', options));
});

// Tapping a notification focuses an already-open Thanzi tab if one exists,
// otherwise opens a new one at the relevant URL.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/thanzi/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/thanzi/') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// If the push subscription itself expires/rotates (this happens after
// extended offline periods, browser data changes, etc.), the browser fires
// this event with a brand-new endpoint. We MUST persist that new endpoint
// somewhere, or the push-scheduler Worker keeps sending to the dead old one,
// gets a 404/410, and deletes the Appwrite doc — silently killing all future
// notifications until the user manually re-toggles them in Settings.
//
// Two-layer fix:
//  1. Try to save the new subscription straight to Appwrite from here,
//     using the cached userId (see PUSH_SET_USER below) and the browser's
//     existing Appwrite session cookie. Works even if no tab is open.
//  2. Also ping any open tabs so push.js can double-check/resync itself
//     (covers cases where step 1 fails, e.g. no session cookie available
//     to the SW yet).
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const newSub = await self.registration.pushManager.subscribe(
        event.oldSubscription
          ? { userVisibleOnly: true, applicationServerKey: event.oldSubscription.options.applicationServerKey }
          : { userVisibleOnly: true }
      );
      const subJson = newSub.toJSON();
      const userId  = await _idbGet('userId');

      if (userId) {
        try {
          await _saveSubscriptionToAppwrite(userId, subJson);
        } catch (err) {
          console.warn('[SW] Direct Appwrite resync failed, relying on client fallback:', err);
        }
      }

      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(c => c.postMessage({ type: 'PUSH_RESUBSCRIBED' }));
    } catch (err) {
      console.warn('[SW] Failed to handle pushsubscriptionchange:', err);
    }
  })());
});

// ── Minimal IndexedDB helper — lets the SW remember which userId this
//    subscription belongs to, so it can resync push_subscriptions in
//    Appwrite even when no app tab is open (see PUSH_SET_USER below). ──────
const _IDB_NAME  = 'thanzi-push';
const _IDB_STORE = 'kv';

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(_IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function _idbSet(key, val) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function _idbGet(key) {
  const db = await _idbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Writes (or updates) the push_subscriptions doc for `userId` directly via
// the Appwrite REST API — no SDK needed, same session cookie the page's own
// Appwrite calls already rely on (credentials: 'include' carries it here too).
async function _saveSubscriptionToAppwrite(userId, subJson) {
  const base       = THANZI_CONFIG.endpoint;
  const dbId       = THANZI_CONFIG.databaseId;
  const collection = THANZI_CONFIG.collections.pushSubscriptions;
  const headers = {
    'Content-Type':       'application/json',
    'X-Appwrite-Project': THANZI_CONFIG.projectId,
  };
  const payload = {
    endpoint: subJson.endpoint,
    p256dh:   subJson.keys.p256dh,
    authKey:  subJson.keys.auth,
  };

  const listUrl = `${base}/databases/${dbId}/collections/${collection}/documents`
    + `?queries[]=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'userId', values: [userId] }))}`
    + `&queries[]=${encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }))}`;

  const listRes = await fetch(listUrl, { headers, credentials: 'include' });
  if (!listRes.ok) throw new Error('list failed ' + listRes.status);
  const listData = await listRes.json();

  if (listData.total > 0) {
    const docId = listData.documents[0].$id;
    const res = await fetch(`${base}/databases/${dbId}/collections/${collection}/documents/${docId}`, {
      method: 'PATCH', headers, credentials: 'include',
      body: JSON.stringify({ data: payload }),
    });
    if (!res.ok) throw new Error('update failed ' + res.status);
  } else {
    // Old doc was already pruned by the scheduler — recreate it.
    const res = await fetch(`${base}/databases/${dbId}/collections/${collection}/documents`, {
      method: 'POST', headers, credentials: 'include',
      body: JSON.stringify({ documentId: 'unique()', data: { userId, ...payload } }),
    });
    if (!res.ok) throw new Error('create failed ' + res.status);
  }
}

// ── Message from app ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    );
  }
  // push.js calls this right after a successful subscribe() so the SW knows
  // whose subscription this is — needed for the background resync above.
  if (event.data?.type === 'PUSH_SET_USER' && event.data.userId) {
    event.waitUntil(_idbSet('userId', event.data.userId));
  }
});
