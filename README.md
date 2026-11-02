# Personal CRM

A self-hosted personal CRM: one place for everyone you know, a timeline of your interactions, keep-in-touch reminders, birthdays, and imports that de-duplicate people by email, phone and LinkedIn.

**Stack:** [Nitro v3](https://nitro.build) (RC) + h3 v2 on the server, Drizzle ORM on SQLite (libsql on Node, D1 on Cloudflare), React 19 + Vite + TanStack Query + Tailwind v4 on the client. The whole thing is a single Vite app; Nitro adds the `/api` routes and builds a server for whichever target you pick.

## Run locally

```bash
npm install
cp .env.example .env   # set APP_PASSWORD
npm run dev            # http://localhost:5173
```

The SQLite database is created at `./data/crm.db`, and migrations run automatically on the first request.

## Deploy on a VM (Node)

```bash
npm run build
APP_PASSWORD=… node .output/server/index.mjs   # listens on $PORT (default 3000)
```

Run it from the repo root so it can find `./drizzle` (or set `MIGRATIONS_DIR`). Put it behind Caddy or nginx for HTTPS. The session cookie is `Secure` in production.

Or with Docker:

```bash
echo "APP_PASSWORD=…" > .env
docker compose up -d   # data persists in ./data
```

`DATABASE_URL` also accepts a `libsql://` Turso URL (with `DATABASE_AUTH_TOKEN`) if you'd rather not keep the file on the VM.

## Deploy on Cloudflare (Workers + D1)

```bash
npx wrangler d1 create personal-crm      # copy the database_id into wrangler.jsonc
npx wrangler secret put APP_PASSWORD
npm run deploy:cf                        # build, apply D1 migrations, deploy
```

To try the Cloudflare build locally:

```bash
npm run build:cf
npx wrangler d1 migrations apply DB --local
npx wrangler dev --var APP_PASSWORD:dev-password
```

Nitro merges `wrangler.jsonc` into `.output/server/wrangler.json` and points wrangler at it, so `wrangler` commands work from the repo root. Static assets are served by Workers Assets; `/api/*` goes to the Worker.

## Duplicates and merging

**Contacts → Review** lists likely duplicates, best first, with the reason for each: the same name (ignoring accents, honorifics and parentheses), nicknames (Bob/Robert), an initial matching a full first name, small typos, the same phone in local vs international format, or the same email username at a different domain. Contacts can never share an email, phone or LinkedIn URL, so these near-misses are what's left after imports and syncs.

- **Merge…** lets you choose which record to keep and which value wins for each conflicting field. Identities, tags, timeline and reminders are combined, notes are joined, and the other records are deleted. The merge runs as a single transaction (`batch()` on D1 and libsql).
- **Not the same person** hides a pair for good.
- Any contact page also has **Merge…** to pick another contact by hand.

Detection runs over the whole contact list on each request. That takes a few hundred milliseconds of CPU at 20k contacts, so on the Workers free plan (10 ms CPU) very large lists may need the paid plan.

## Google sync

Connect a Google account under **Settings** to pull in:

- **Contacts**: your Google address book. Contacts are matched to existing people by email, phone or LinkedIn; only blank fields are filled.
- **Calendar**: past meetings with 1–15 other people become "meeting" interactions. Attendees you haven't met before are added as contacts. Declined, cancelled, all-day and large events are skipped.
- **Gmail**: one "email" interaction per thread, with the subject and Gmail's snippet. Only headers are read, through the `gmail.metadata` scope; message bodies are never fetched. People you write to become contacts. Received mail only links to people you already have. Newsletters (`List-Unsubscribe`), promotions, social and updates tabs, and no-reply senders are ignored.

The first sync runs from the Settings page and goes back `SYNC_BACKFILL_DAYS` (default 180). After that, a scheduled task syncs every 10 minutes: on Node via Nitro's in-process scheduler, on Cloudflare via a cron trigger that Nitro adds to the generated wrangler config. Each tick handles one source per account, which stays inside Workers' free-plan limits.

### Google Cloud setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and enable the **People API**, **Gmail API** and **Google Calendar API**.
2. Configure the **OAuth consent screen**: External, and add yourself as a test user.
3. Create an **OAuth client ID** of type *Web application*. Set its authorized redirect URI to `https://<your-host>/api/integrations/google/callback`; Settings shows the exact value the server expects.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (`wrangler secret put …` on Cloudflare) and restart.

> **Refresh tokens and "Testing" mode:** while the consent screen's publishing status is *Testing*, Google expires refresh tokens after 7 days, and you'll see "reconnect" errors weekly. For long-lived personal use, set the status to *In production*. You don't need to submit for verification; Google shows an "unverified app" warning on the consent screen, which is fine for your own account.

OAuth tokens are encrypted in the database with a key derived from `GOOGLE_CLIENT_SECRET`. Disconnecting an account revokes the grant but keeps everything already synced.

## Database changes

Edit `server/db/schema.ts`, then:

```bash
npm run db:generate   # writes a new SQL file to ./drizzle
```

Node applies it on the next start. On Cloudflare, `npm run deploy:cf` applies it, or run `wrangler d1 migrations apply DB --remote`.

## Layout

```
server/
  db/schema.ts        Drizzle schema: contacts, identities, tags, interactions, reminders
  api/                File-based routes → /api/*
  middleware/auth.ts  Password session guard for /api
  utils/db.ts         Picks D1 (Cloudflare binding `DB`) or libsql (Node)
  utils/contacts.ts   Queries shared by routes
  utils/ingest.ts     Idempotent bulk upserts shared by import and sync
  utils/duplicates.ts Duplicate detection (pure, in-memory)
  utils/merge.ts      Atomic contact merge
  utils/google/       OAuth client and resumable sync steps
  tasks/google/       Scheduled incremental sync
src/
  pages/              Home, Contacts, ContactDetail, Reminders, Import
  lib/importers.ts    LinkedIn / Google / generic CSV → contacts (parsed in the browser)
```

### Design notes

- **Identities drive de-duplication.** `contact_identities` has a unique `(kind, value)` index on normalized values: lowercased emails, digit-only phone numbers, LinkedIn handles. Imports match on any of them; manually adding an identity that belongs to someone else returns 409 with that contact's id.
- **No interactive transactions.** D1 doesn't support them from a Worker, so routes do sequential writes and undo by hand where it matters.
- **Imports run in batches of 25** from the browser, which keeps each request well under D1's per-invocation query limit (50 on the free plan).
- **Interactions have `source` + `external_id`** (unique together), so syncs (Gmail thread id, Calendar event id) can re-run without duplicating anything.
- **Auth is single-user:** one `APP_PASSWORD`, sealed cookie session. On Cloudflare you can also put the app behind Cloudflare Access.
