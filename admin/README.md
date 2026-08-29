# Thanzi Content Desk

A standalone admin CMS for the Learn panel's `education_articles`
collection. Lives at `/admin/`, not linked from the main app.

## One-time setup (Appwrite console)

Attribute/collection creation and permissions can only be done from the
Appwrite console (or a server API key) — not from this browser-based
panel. Do this once:

1. **Collection** — in the `thanzi-db` database, confirm `education_articles`
   exists (Databases → thanzi-db → Collections). Create it if not.

2. **Attributes** — add these if missing:
   | Key        | Type    | Size / config       | Required |
   |------------|---------|----------------------|----------|
   | `title`    | String  | 200                  | Yes      |
   | `category` | String  | 60                   | Yes      |
   | `tags`     | String  | 60, **array**        | No       |
   | `read_min` | Integer | —                    | Yes      |
   | `summary`  | String  | 300                  | Yes      |
   | `body`     | String  | 2000, **array**      | Yes      |
   | `status`   | String  | 20 (values: `draft`, `published`) | Yes |
   | `topic_seed` | String | 300                | Yes      |

   `topic_seed` was added by the weekly RAG generator (a separate repo)
   to track the prompt behind each generated article — Appwrite treats
   it as required for every document, so the CMS and seed script both
   fill it with the article's title for hand-written entries.

3. **Permissions** — this is the actual security boundary; the
   preference check in `admin.js` is UI-only (a user can edit their own
   preferences, so it doesn't lock anything by itself).
   - If the collection has **Document Security** enabled (Settings →
     Permissions → toggle at the top), collection-level permissions are
     ignored per document — `admin.js` already passes explicit
     read/update/delete permissions on every document it creates, so
     this works either way.
   - Either way, also add yourself (by user ID, not "any authenticated
     user") at the **collection level** with **Read** at minimum, so
     the panel can list existing documents.
   - Do **not** grant collection-level Create/Update/Delete to "any
     authenticated user" — that would let anyone who signs up for a
     Thanzi account write articles.

4. **Mark your account as admin** — Auth → Users → select your account
   → Preferences → add:
   ```json
   { "role": "admin" }
   ```
   This is what unlocks the Content Desk UI for that account. Nothing
   is hardcoded in the code, so this is the only place access is
   granted or revoked — add the same preference to any other account
   you want editing rights, or remove it to cut access.

## Seeding the static library

Recommended path: `../scripts/seed-education-articles.js`, run from
Termux with a server API key. Server keys bypass collection/document
permissions entirely, so it works no matter how Document Security is
configured — see `scripts/seed-education-articles.js` header for setup
and usage.

The panel also has a **Seed static library** button that does the same
thing from the browser using your admin session — kept as a fallback,
but it depends on the document-permission setup in step 3 above being
correct, so if it errors, use the script instead.

## Using it

- Visit `yourdomain.com/admin/` and sign in with that account.
- New/edited articles: **Body** field — separate paragraphs with a
  blank line, each becomes one paragraph in the rendered article.
- **Tags** — comma-separated. These drive the Learn panel's "For You"
  matching, so keep them aligned with the taxonomy documented at the
  top of `js/thanzi-education.js` (goal names, health-interest ids,
  `nutrient:Name`, `module:name`).
- Draft articles never reach the app — `thanzi-education.js` only
  fetches documents where `status == 'published'`.
