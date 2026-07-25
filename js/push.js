/**
 * push.js — Thanzi Web Push subscription manager  (v1.0)
 *
 * Handles the CLIENT side of full push notifications (delivered even when
 * the app is fully closed):
 *   1. Requests Notification permission from the user
 *   2. Subscribes to the browser's Push service via the service worker
 *      (PushManager.subscribe) using Thanzi's VAPID public key
 *   3. Saves the subscription (endpoint + keys) plus the user's reminder
 *      preferences and IANA timezone to Appwrite, in the
 *      `push_subscriptions` collection
 *
 * The actual SENDING of push messages at the right time is done by a
 * separate Cloudflare Worker (see /workers/push-scheduler) running on a
 * Cron Trigger — it reads this same Appwrite collection, works out whose
 * reminder time has arrived in their own timezone, and sends the push.
 * This file has no knowledge of when messages go out; it only keeps the
 * subscription + preferences in sync.
 *
 * Actually displaying an incoming push (even while the app is closed) is
 * handled by the `push` event listener in sw.js — that part works
 * regardless of anything in this file, since it's the service worker
 * itself that wakes up to show the notification.
 */

const ThanziPush = (function () {

  // ── Appwrite ───────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);
  const _db = new Appwrite.Databases(_client);

  const COLLECTION = (THANZI_CONFIG.collections && THANZI_CONFIG.collections.pushSubscriptions)
    || 'push_subscriptions';

  // Public VAPID key — safe to embed client-side (the private key lives only
  // as a secret on the Cloudflare Worker that sends the pushes).
  const VAPID_PUBLIC_KEY = 'BFlRFa52--DBvCYOJXSE3ZGbbrzSFw5GfMZuBtRsdN2f24TSuChQRxNko_QoJBldF_Aq0MouK4QLk36xUG8QAFg';

  let _user  = null;
  let _docId = null; // cached Appwrite document $id for this user's subscription, once known

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _urlBase64ToUint8Array(base64String) {
    const padding    = '='.repeat((4 - base64String.length % 4) % 4);
    const base64     = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData    = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function isSupported() {
    return typeof window !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager'   in window
      && 'Notification'  in window;
  }

  /** 'granted' | 'denied' | 'default' | 'unsupported' */
  function permissionState() {
    return isSupported() ? Notification.permission : 'unsupported';
  }

  async function _getRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.ready;
  }

  async function _findExistingDoc(userId) {
    const res = await _db.listDocuments(THANZI_CONFIG.databaseId, COLLECTION, [
      Appwrite.Query.equal('userId', userId),
      Appwrite.Query.limit(1),
    ]);
    return res.total > 0 ? res.documents[0] : null;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Called once on app load with the signed-in user (no side effects — just
   *  remembers who's signed in for later subscribe()/updatePrefs() calls). */
  function init(user) {
    _user  = user;
    _docId = null;
  }

  /** True if this browser already holds a live push subscription. */
  async function hasActiveSubscription() {
    const reg = await _getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  }

  /**
   * Requests permission (if needed), subscribes to push, and upserts the
   * subscription + preferences into Appwrite. `prefs` should match the
   * fields the Notifications tab collects, e.g.:
   *   { mealReminders, mealBreakfast, mealLunch, mealDinner,
   *     waterReminders, waterInterval, weeklyReport, goalAlert }
   */
  async function subscribe(prefs = {}) {
    if (!isSupported()) {
      throw new Error('Push notifications aren\'t supported on this browser/device.');
    }
    if (!_user || !_user.$id) {
      throw new Error('Sign in to enable notifications.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission was not granted.');
    }

    const reg = await _getRegistration();
    if (!reg) throw new Error('Service worker isn\'t ready yet — try again in a moment.');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json     = sub.toJSON();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const payload = {
      userId:   _user.$id,
      endpoint: json.endpoint,
      p256dh:   json.keys.p256dh,
      authKey:  json.keys.auth,
      timezone,
      ...prefs,
    };

    await _upsertDoc(payload);
    return sub;
  }

  async function _upsertDoc(payload) {
    try {
      const existing = _docId ? { $id: _docId } : await _findExistingDoc(payload.userId);
      if (existing) {
        await _db.updateDocument(THANZI_CONFIG.databaseId, COLLECTION, existing.$id, payload);
        _docId = existing.$id;
      } else {
        const doc = await _db.createDocument(
          THANZI_CONFIG.databaseId, COLLECTION, Appwrite.ID.unique(), payload
        );
        _docId = doc.$id;
      }
    } catch (err) {
      console.error('[Push] Failed to save subscription:', err);
      throw err;
    }
  }

  /**
   * Updates just the reminder-preference fields on an existing subscription
   * (no-ops quietly if the user hasn't subscribed to push yet — preferences
   * will be picked up the next time they do via subscribe()).
   */
  async function updatePrefs(prefs) {
    if (!_user || !_user.$id) return;
    try {
      const existing = _docId ? { $id: _docId } : await _findExistingDoc(_user.$id);
      if (!existing) return; // not subscribed — nothing to update server-side yet
      await _db.updateDocument(THANZI_CONFIG.databaseId, COLLECTION, existing.$id, prefs);
      _docId = existing.$id;
    } catch (err) {
      console.error('[Push] Failed to update preferences:', err);
    }
  }

  /** Unsubscribes locally and removes the Appwrite subscription document. */
  async function unsubscribe() {
    try {
      const reg = await _getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (err) {
      console.warn('[Push] Local unsubscribe failed:', err);
    }

    if (_user && _user.$id) {
      try {
        const existing = _docId ? { $id: _docId } : await _findExistingDoc(_user.$id);
        if (existing) {
          await _db.deleteDocument(THANZI_CONFIG.databaseId, COLLECTION, existing.$id);
        }
      } catch (err) {
        console.warn('[Push] Failed to remove subscription document:', err);
      }
    }
    _docId = null;
  }

  /**
   * Shows a local notification via the service worker to confirm permission
   * + display are working on this device. NOTE: this does not exercise the
   * real network push path (that only happens via the Cloudflare Worker
   * cron) — it's purely a "yes, notifications can appear on this device" check.
   */
  async function sendLocalTestNotification() {
    const reg = await _getRegistration();
    if (!reg) throw new Error('Service worker isn\'t ready yet.');
    await reg.showNotification('Thanzi', {
      body: 'Notifications are working — you\'ll get reminders like this.',
      icon: 'icons/web-app-manifest-192x192.png',
      badge: 'icons/favicon-96x96.png',
      tag: 'thanzi-test',
    });
  }

  return {
    init,
    isSupported,
    permissionState,
    hasActiveSubscription,
    subscribe,
    unsubscribe,
    updatePrefs,
    sendLocalTestNotification,
  };
})();
