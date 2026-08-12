# Thanzi push-scheduler

A small Cloudflare Worker that sends real Web Push notifications (meal
reminders, water reminders, weekly recap nudge) even when the Thanzi app is
fully closed. It runs on a Cron Trigger every 5 minutes, reads everyone's
subscription + preferences from Appwrite, and sends pushes to whoever's
reminder time has arrived in their own timezone.

No `web-push` npm package is used — Cloudflare Workers can't run Node-only
packages like that, so VAPID JWT signing and the RFC 8291 (`aes128gcm`)
payload encryption are implemented directly against the Web Crypto API in
`worker.js`. This has been round-trip tested (encrypt → decrypt the way a
real browser/push service would, and JWT signature verification) and is
spec-correct.

## What it does / doesn't do

✅ Meal reminders (breakfast/lunch/dinner) at the times set in the app's
   Notifications tab, once per day per meal, in the user's own timezone.
✅ Water reminders every N hours, only between 7am–9pm local time.
✅ A weekly recap nudge on Sunday evenings (a reminder to open the app —
   the actual stats are computed by the app itself when opened).
✅ Auto-cleanup: if a push fails with 404/410 (subscription expired /
   revoked), the worker deletes that subscription document.

✅ "Goal Reached Alerts" — sent the moment a logged meal pushes the day's
   total kcal at/over the user's daily target, via an Appwrite Webhook on
   `food_logs` creates hitting `/webhook/food-log-created` (event-driven,
   not the 5-min cron — see step 4 below). `js/goals.js` mirrors the target
   to `dailyGoalKcal` on the subscription doc whenever the plan is saved.

## 1. Create the Appwrite collection

In your Appwrite console, in the same database as the rest of Thanzi's
collections (`thanzi-db` by default), create a collection with ID
**`push_subscriptions`** and these attributes:

| Attribute            | Type    | Size / notes                  | Required |
|-----------------------|---------|--------------------------------|----------|
| `userId`              | string  | 64                              | ✅ |
| `endpoint`            | string  | 512                             | ✅ |
| `p256dh`              | string  | 128                             | ✅ |
| `authKey`             | string  | 64                              | ✅ |
| `timezone`            | string  | 64 (IANA name, e.g. `Africa/Blantyre`) | ✅ |
| `mealReminders`       | boolean | default `false`                 |  |
| `mealBreakfast`       | string  | 8 (e.g. `08:00`)                |  |
| `mealLunch`           | string  | 8                                |  |
| `mealDinner`          | string  | 8                                |  |
| `waterReminders`      | boolean | default `false`                 |  |
| `waterInterval`       | integer | default `2`                     |  |
| `weeklyReport`        | boolean | default `false`                 |  |
| `goalAlert`           | boolean | default `true`                  |  |
| `dailyGoalKcal`        | integer | synced from the app's saved plan |  |
| `lastGoalAlertDate`    | string  | 12 (date `YYYY-MM-DD`)          |  |
| `lastBreakfastSent`   | string  | 12 (date `YYYY-MM-DD`)          |  |
| `lastLunchSent`       | string  | 12                                |  |
| `lastDinnerSent`      | string  | 12                                |  |
| `lastWaterSentAt`     | string  | 32 (ISO datetime)                |  |
| `lastWeeklySentWeek`  | string  | 12 (e.g. `2026-W30`)             |  |

Add an index on `userId` (key/unique isn't required, but a regular index
speeds up lookups).

**Permissions:** since the client (`js/push.js`) creates/updates/deletes its
own subscription document, grant **Create/Read/Update/Delete for "Users"**
(or "Any authenticated user") at the collection level, same pattern as your
other user-owned collections like `food_logs`.

## 2. Create a server API key for the worker

In Appwrite console → **Overview → Integrations → API Keys** → create a new
key (not the same as your client SDK project key) with scopes:
- `databases.read`
- `databases.write`

Copy the generated key — you'll set it as `APPWRITE_API_KEY` below. Keep it
secret; never put it in client-side code.

## 3. Deploy the worker

You'll need Node + npm somewhere with internet access (this doesn't have to
be the same device you develop on — Termux with `pkg install nodejs` works
fine too).

```bash
cd workers/push-scheduler
npm install -g wrangler      # if you don't already have it
wrangler login                # opens a browser to authorize your Cloudflare account
```

Set the secrets (you'll be prompted to paste each value):

```bash
wrangler secret put VAPID_PUBLIC_KEY
# BFlRFa52--DBvCYOJXSE3ZGbbrzSFw5GfMZuBtRsdN2f24TSuChQRxNko_QoJBldF_Aq0MouK4QLk36xUG8QAFg

wrangler secret put VAPID_PRIVATE_KEY
# QIY9-w110p5WB9CeiEyj_gyXQsXUdw5YeSn6uqCihpg
# ⚠️ Keep this one secret — it must never appear in client-side code.

wrangler secret put VAPID_SUBJECT
# mailto:you@yourdomain.com   (a contact address push services may use to reach you)

wrangler secret put APPWRITE_ENDPOINT
# https://fra.cloud.appwrite.io/v1

wrangler secret put APPWRITE_PROJECT_ID
# thanzi-app

wrangler secret put APPWRITE_API_KEY
# (the server API key from step 2)

wrangler secret put APPWRITE_DATABASE_ID
# thanzi-db

wrangler secret put WEBHOOK_SECRET
# any long random string you make up — used to authenticate the Goal
# Reached webhook Appwrite calls in step 5 below.
```

> The VAPID key pair above was generated specifically for this project and
> is already hardcoded as `VAPID_PUBLIC_KEY` in `js/push.js` on the
> frontend — use the same pair here so the public/private keys match. If
> you'd rather generate your own pair, you must update **both** places
> together (the public key in `js/push.js` and both keys as Worker
> secrets), or existing subscriptions will fail to decrypt.

Then deploy:

```bash
wrangler deploy
```

This prints a `*.workers.dev` URL — that's your scheduler's HTTP endpoint
(used only for manual testing below; the cron runs automatically once
deployed and needs no URL).

## 4. Test it before trusting the cron

1. In the Thanzi app, go to **Profile → Notifications**, turn on a reminder,
   and hit **Save Preferences** (grant the browser's permission prompt).
   This creates your `push_subscriptions` document.
2. Find your Appwrite `userId` (Profile tab, or from the Appwrite console
   under the `push_subscriptions` collection).
3. Send yourself a manual test push:

```bash
curl -X POST https://thanzi-push-scheduler.<your-subdomain>.workers.dev/send-test \
  -H "Content-Type: application/json" \
  -d '{"userId":"<your-user-id>","title":"Hello","body":"Testing 1 2 3"}'
```

You should get a real notification within a few seconds — even with the
Thanzi tab/app fully closed. If you get `{"error":"No subscription found..."}`,
double check the Notifications tab actually saved successfully (check the
Appwrite console for a document with your `userId`).

4. To dry-run the full scheduled logic on demand (without waiting for the
   next 5-minute tick):

```bash
curl -X POST https://thanzi-push-scheduler.<your-subdomain>.workers.dev/run-now
```

This returns a summary `{ checked, sent, removed, errors }` and is exactly
what the cron trigger runs automatically going forward.

## 5. Wire up the Goal Reached webhook

This is the one push that's event-driven instead of cron-polled — it fires
the instant a logged meal crosses the day's kcal target, instead of waiting
for the next 5-minute cron tick.

1. In the Appwrite console, go to your project → **Settings → Webhooks** →
   **Create webhook**.
2. **Name:** `thanzi-goal-reached` (or anything).
3. **URL:** `https://thanzi-push-scheduler.<your-subdomain>.workers.dev/webhook/food-log-created`
4. **Events:** tick only `databases.*.collections.food_logs.documents.*.create`
   (Appwrite's event picker lets you scope this to just the `food_logs`
   collection and just the `create` action — don't tick update/delete).
5. **Headers:** add a custom header `X-Webhook-Secret` with the exact same
   value you set as `WEBHOOK_SECRET` in step 3. This is how the worker
   authenticates the request — without a matching header it returns `401`.
6. Save, and enable the webhook.

To actually get alerts, a user also needs `dailyGoalKcal` set on their
subscription doc — this happens automatically the next time they open
**Goals** and hit **Save Goal**, as long as push is already enabled
(`js/goals.js` calls `ThanziPush.updatePrefs({ dailyGoalKcal })`, which
no-ops quietly if they haven't subscribed to push yet).

**Test it:** log a meal in the app that pushes today's total over your
saved goal. You should get a "🎯 Goal reached!" push within a couple
seconds — no cron wait. Only fires once per day per user
(`lastGoalAlertDate` dedupes it), resetting automatically the next day.

## Notes

- Cloudflare Workers' free tier includes Cron Triggers; a 5-minute schedule
  well within free-tier request limits for any realistic Thanzi user count.
- If you rotate the VAPID key pair later, existing subscriptions will start
  failing (browsers re-key push subscriptions to a specific
  `applicationServerKey`) — users will need to re-save their Notifications
  preferences once to re-subscribe under the new key.
