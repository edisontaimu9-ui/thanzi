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

3. **Permissions** — this is the actual security boundary; the email
   check in `admin.js` is UI-only. On the collection's **Settings →
   Permissions**:
   - Add yourself (by user ID, not "any authenticated user") with
     **Create, Read, Update, Delete**.
   - Keep a separate **Read**-only permission for `any` or `users` so
     the Learn panel can still fetch published articles for everyone.
   - Do **not** grant Create/Update/Delete to "any authenticated user"
     — that would let anyone who signs up for a Thanzi account write
     articles.

## One-time setup (this code)

Open `admin/admin.js` and replace the placeholder with your real
Thanzi account email:

```js
const ADMIN_EMAILS = [
  'you@example.com',
];
```

## Using it

- Visit `yourdomain.com/admin/` and sign in with that account.
- **Seed static library** pulls the hand-written articles baked into
  `js/thanzi-education.js` (`ThanziEducation.ARTICLES`) into Appwrite,
  one document per article, keyed by the article's own `id` — safe to
  click more than once, already-seeded ones are skipped.
- New/edited articles: **Body** field — separate paragraphs with a
  blank line, each becomes one paragraph in the rendered article.
- **Tags** — comma-separated. These drive the Learn panel's "For You"
  matching, so keep them aligned with the taxonomy documented at the
  top of `js/thanzi-education.js` (goal names, health-interest ids,
  `nutrient:Name`, `module:name`).
- Draft articles never reach the app — `thanzi-education.js` only
  fetches documents where `status == 'published'`.
