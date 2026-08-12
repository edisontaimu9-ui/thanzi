/**
 * Thanzi push-scheduler — Cloudflare Worker
 *
 * Runs on a Cron Trigger (every 5 minutes). Reads every document in the
 * Appwrite `push_subscriptions` collection, works out whose meal/water/
 * weekly reminder time has just arrived IN THEIR OWN TIMEZONE, and sends
 * them a real Web Push message — no external libraries, just the Web
 * Crypto API (VAPID JWT signing + RFC 8291 aes128gcm payload encryption
 * implemented directly, since Workers can't use Node's `web-push` package).
 *
 * Also exposes a small HTTP interface for manual testing:
 *   GET  /              → health check
 *   POST /send-test      { userId }  → sends one push to that user right now
 *
 * ── Required secrets (wrangler secret put <name>) ──────────────────────────
 *   VAPID_PUBLIC_KEY     same value hardcoded in js/push.js on the frontend
 *   VAPID_PRIVATE_KEY    keep this SECRET — never expose it client-side
 *   VAPID_SUBJECT        e.g. "mailto:you@example.com" (contact for push services)
 *   APPWRITE_ENDPOINT     e.g. "https://fra.cloud.appwrite.io/v1"
 *   APPWRITE_PROJECT_ID   e.g. "thanzi-app"
 *   APPWRITE_API_KEY      Appwrite SERVER API key with databases read/write scope
 *   APPWRITE_DATABASE_ID  e.g. "thanzi-db"
 *
 * See README.md in this folder for full setup instructions.
 */

const COLLECTION       = 'push_subscriptions';
const CRON_WINDOW_MIN  = 5;     // must match the cron schedule in wrangler.toml
const PUSH_TTL_SECONDS = 86400; // how long a push service should keep retrying delivery

// ════════════════════════════════════════════════════════════════════════════
// Entry points
// ════════════════════════════════════════════════════════════════════════════

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCheck(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/send-test' && request.method === 'POST') {
      try {
        const { userId, title, body } = await request.json();
        if (!userId) return json({ error: 'userId is required' }, 400);
        const sub = await findSubscriptionByUserId(env, userId);
        if (!sub) return json({ error: 'No subscription found for that userId' }, 404);
        const result = await sendPush(env, sub, {
          title: title || 'Thanzi test',
          body:  body  || 'This is a manual test push. If you see this, delivery works!',
          tag:   'thanzi-test',
          url:   '/thanzi/',
        });
        return json({ ok: true, result });
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 500);
      }
    }

    if (url.pathname === '/run-now' && request.method === 'POST') {
      // Manually trigger the same logic the cron uses — handy for testing
      // without waiting for the schedule.
      const summary = await runScheduledCheck(env);
      return json({ ok: true, summary });
    }

    return json({ ok: true, service: 'thanzi-push-scheduler' });
  },
};

// ════════════════════════════════════════════════════════════════════════════
// Scheduled check — the actual reminder logic
// ════════════════════════════════════════════════════════════════════════════

async function runScheduledCheck(env) {
  const subs = await listAllSubscriptions(env);
  const summary = { checked: subs.length, sent: 0, removed: 0, errors: 0 };

  for (const sub of subs) {
    try {
      const nowLocal = localTimeParts(sub.timezone);
      const updates  = {};
      let shouldSend = null;

      // ── Meal reminders (fixed HH:MM, once per day per meal) ──────────────
      if (sub.mealReminders) {
        const meals = [
          ['mealBreakfast', sub.mealBreakfast, 'lastBreakfastSent', '🌅 Breakfast time',
            "Don't forget to log your breakfast in Thanzi."],
          ['mealLunch',     sub.mealLunch,     'lastLunchSent',     '☀️ Lunch time',
            "Time to log your lunch in Thanzi."],
          ['mealDinner',    sub.mealDinner,    'lastDinnerSent',    '🌙 Dinner time',
            "Don't forget to log dinner before the day ends."],
        ];
        for (const [, timeStr, lastField, title, body] of meals) {
          if (!timeStr) continue;
          if (!shouldSend
              && withinWindow(nowLocal.hhmm, timeStr, CRON_WINDOW_MIN)
              && sub[lastField] !== nowLocal.dateStr) {
            shouldSend = { title, body, tag: 'thanzi-meal', url: '/thanzi/' };
            updates[lastField] = nowLocal.dateStr;
          }
        }
      }

      // ── Water reminders (every N hours, within a waking window) ──────────
      if (!shouldSend && sub.waterReminders) {
        const interval  = Math.max(1, Math.min(8, sub.waterInterval || 2));
        const lastSent  = sub.lastWaterSentAt ? new Date(sub.lastWaterSentAt).getTime() : 0;
        const elapsedHr = (Date.now() - lastSent) / 3600000;
        const awake     = nowLocal.hour >= 7 && nowLocal.hour <= 21; // 7am–9pm local
        if (awake && elapsedHr >= interval) {
          shouldSend = {
            title: '💧 Stay hydrated',
            body:  "It's been a while — time for a glass of water.",
            tag:   'thanzi-water',
            url:   '/thanzi/',
          };
          updates.lastWaterSentAt = new Date().toISOString();
        }
      }

      // ── Weekly summary nudge (Sunday evening local time, once a week) ────
      if (!shouldSend && sub.weeklyReport) {
        const isSunday = nowLocal.weekday === 0;
        if (isSunday
            && withinWindow(nowLocal.hhmm, '18:00', CRON_WINDOW_MIN)
            && sub.lastWeeklySentWeek !== nowLocal.isoWeek) {
          shouldSend = {
            title: '📊 Your weekly recap is ready',
            body:  'Open Thanzi to see how your week went.',
            tag:   'thanzi-weekly',
            url:   '/thanzi/',
          };
          updates.lastWeeklySentWeek = nowLocal.isoWeek;
        }
      }

      // NOTE — "Goal Reached Alerts" aren't sent from this scheduler: that's
      // an event (hitting today's calorie goal), not a scheduled time, and
      // the calorie goal itself currently only lives in the browser's
      // localStorage, not Appwrite — this worker has no way to see it.
      // Wiring that up would mean syncing the goal to Appwrite and either
      // triggering a send from the client the moment the goal is hit, or
      // having this worker query today's food_logs total against a
      // server-stored goal. Left as a future enhancement.

      if (shouldSend) {
        await sendPush(env, sub, shouldSend);
        summary.sent++;
      }
      if (Object.keys(updates).length) {
        await updateSubscriptionDoc(env, sub.$id, updates);
      }
    } catch (err) {
      summary.errors++;
      console.error('[push-scheduler] error for sub', sub.$id, err);
    }
  }

  return summary;
}

// ════════════════════════════════════════════════════════════════════════════
// Time helpers
// ════════════════════════════════════════════════════════════════════════════

function localTimeParts(timezone) {
  const tz = timezone || 'UTC';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;

  const hour   = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  const hhmm   = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.weekday] ?? now.getUTCDay();

  // ISO week string, good enough as a "have we sent this week" dedupe key
  const d = new Date(Date.UTC(parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day)));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
  const isoWeek = `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;

  return { hour, minute, hhmm, dateStr, weekday, isoWeek };
}

/** True if `target` (HH:MM) falls within `windowMin` minutes at/after `hhmm`. */
function withinWindow(hhmm, target, windowMin) {
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const now = toMin(hhmm), t = toMin(target);
  const diff = now - t;
  return diff >= 0 && diff < windowMin;
}

// ════════════════════════════════════════════════════════════════════════════
// Appwrite REST helpers (no SDK — Workers-friendly plain fetch)
// ════════════════════════════════════════════════════════════════════════════

function appwriteHeaders(env) {
  return {
    'Content-Type':        'application/json',
    'X-Appwrite-Project':  env.APPWRITE_PROJECT_ID,
    'X-Appwrite-Key':      env.APPWRITE_API_KEY,
  };
}

function q(method, attribute, values) {
  return JSON.stringify({ method, attribute, values: Array.isArray(values) ? values : [values] });
}
function qLimit(n)  { return JSON.stringify({ method: 'limit',  values: [n] }); }
function qOffset(n) { return JSON.stringify({ method: 'offset', values: [n] }); }

async function listAllSubscriptions(env) {
  const all = [];
  let offset = 0;
  const pageSize = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams();
    params.append('queries[]', qLimit(pageSize));
    params.append('queries[]', qOffset(offset));
    const res = await fetch(
      `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE_ID}/collections/${COLLECTION}/documents?${params}`,
      { headers: appwriteHeaders(env) }
    );
    if (!res.ok) throw new Error(`Appwrite list failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    all.push(...data.documents);
    if (data.documents.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function findSubscriptionByUserId(env, userId) {
  const params = new URLSearchParams();
  params.append('queries[]', q('equal', 'userId', [userId]));
  params.append('queries[]', qLimit(1));
  const res = await fetch(
    `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE_ID}/collections/${COLLECTION}/documents?${params}`,
    { headers: appwriteHeaders(env) }
  );
  if (!res.ok) throw new Error(`Appwrite query failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.total > 0 ? data.documents[0] : null;
}

async function updateSubscriptionDoc(env, docId, fields) {
  const res = await fetch(
    `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE_ID}/collections/${COLLECTION}/documents/${docId}`,
    { method: 'PATCH', headers: appwriteHeaders(env), body: JSON.stringify({ data: fields }) }
  );
  if (!res.ok) console.error('[push-scheduler] failed to update doc', docId, res.status, await res.text());
}

async function deleteSubscriptionDoc(env, docId) {
  await fetch(
    `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE_ID}/collections/${COLLECTION}/documents/${docId}`,
    { method: 'DELETE', headers: appwriteHeaders(env) }
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Web Push — VAPID JWT + RFC 8291 (aes128gcm) payload encryption
// Implemented directly against Web Crypto since Workers can't use the
// Node-only `web-push` npm package.
// ════════════════════════════════════════════════════════════════════════════

async function sendPush(env, sub, message) {
  const endpoint = sub.endpoint;
  const p256dh   = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.authKey);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(message));
  const { body, serverPublicKey } = await encryptPayload(payloadBytes, p256dh, authSecret);

  const audience = new URL(endpoint).origin;
  const jwt = await createVapidJWT(audience, env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':              String(PUSH_TTL_SECONDS),
      'Authorization':    `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  if (res.status === 404 || res.status === 410) {
    // Subscription is dead (user revoked permission, uninstalled, etc.) —
    // clean it up so we stop wasting cron cycles on it.
    await deleteSubscriptionDoc(env, sub.$id);
    return { status: res.status, removed: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Push send failed: ${res.status} ${text}`);
  }
  return { status: res.status };
}

async function createVapidJWT(audience, subject, publicKeyB64url, privateKeyB64url) {
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject || 'mailto:admin@example.com',
  };

  const encoder = new TextEncoder();
  const signingInput = `${b64url(encoder.encode(JSON.stringify(header)))}.${b64url(encoder.encode(JSON.stringify(payload)))}`;

  const privateKey = await importVapidPrivateKey(publicKeyB64url, privateKeyB64url);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(signingInput)
  );
  // Web Crypto's ECDSA signature is already raw r||s (IEEE P1363) — exactly
  // what a JWS ES256 signature needs, no DER conversion required.
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function importVapidPrivateKey(publicKeyB64url, privateKeyB64url) {
  const pub = b64urlToBytes(publicKeyB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x:   bytesToB64url(pub.slice(1, 33)),
    y:   bytesToB64url(pub.slice(33, 65)),
    d:   privateKeyB64url, // already base64url, 32 raw bytes
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/**
 * Encrypts `payloadBytes` per RFC 8291 ("aes128gcm" content-encoding) for
 * delivery to a single Web Push subscriber.
 *   p256dh     = subscriber's public key (65 raw bytes)
 *   authSecret = subscriber's auth secret (16 raw bytes)
 * Returns { body: Uint8Array, serverPublicKey } ready to POST as-is.
 */
async function encryptPayload(payloadBytes, p256dh, authSecret) {
  // 1. Ephemeral "application server" EC key pair for this message
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  ); // 65 bytes, uncompressed point

  // 2. Import subscriber's public key for ECDH
  const userPublicKey = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // 3. ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: userPublicKey }, serverKeyPair.privateKey, 256
    )
  );

  // 4. PRK_key = HKDF-Extract(salt=authSecret, ikm=sharedSecret); then expand
  //    with "WebPush: info" || 0x00 || ua_pub || as_pub  →  IKM (32 bytes)
  const sharedSecretKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    p256dh,
    serverPublicKeyRaw
  );
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, sharedSecretKey, 256
    )
  );

  // 5. Per-message salt, then derive CEK (16 bytes) and NONCE (12 bytes) from IKM
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, ikmKey, 128)
  );

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, ikmKey, 96)
  );

  // 6. Encrypt: plaintext || 0x02 (single-record delimiter), AES-128-GCM
  const plaintext = concatBytes(payloadBytes, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext)
  );

  // 7. aes128gcm header: salt(16) || recordSize(4, BE) || idlen(1) || keyid(as_pub, 65)
  const recordSize = 4096; // safely larger than any of our short notification payloads
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = serverPublicKeyRaw.length;
  header.set(serverPublicKeyRaw, 21);

  return { body: concatBytes(header, ciphertext), serverPublicKey: serverPublicKeyRaw };
}

// ════════════════════════════════════════════════════════════════════════════
// Small utilities
// ════════════════════════════════════════════════════════════════════════════

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

function b64url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesToB64url(bytes) { return b64url(bytes); }

function b64urlToBytes(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
