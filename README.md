# PRM: Personal Relationship Manager

A self-hosted personal relationship manager (PRM): one place for everyone you know, a timeline of your interactions, keep-in-touch reminders, birthdays, and imports that de-duplicate people by email, phone and LinkedIn.

**Stack:** [Nitro v3](https://nitro.build) (RC) + h3 v2 on the server, Drizzle ORM on SQLite (libsql on Node, D1 on Cloudflare), React 19 + Vite + TanStack Query + Tailwind v4 on the client. The whole thing is a single Vite app; Nitro adds the `/api` routes and builds a server for whichever target you pick.

## Run locally

```bash
npm install
cp .env.example .env   # set APP_PASSWORD
npm run dev            # http://localhost:5173
```

The SQLite database is created at `./data/prm.db`, and migrations run automatically on the first request.

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
npx wrangler d1 create prm      # copy the database_id into wrangler.jsonc
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

Detection is a background job; viewing duplicates only reads stored results (`duplicate_candidates`). A scan starts in either of two ways:

- **Cron**, every 30 minutes, skipped when nothing relevant changed (it compares a fingerprint of contacts and identities with the last scan).
- **On demand**, from **Scan now** or automatically when the review page opens and the results are stale. `POST /api/duplicates/scan` returns 202 immediately; the scan continues via `waitUntil` and the page polls until it's done.

A lock row in `jobs` keeps it to one scan at a time; a claim older than 10 minutes is treated as dead. The best 500 pairs are stored and replaced in one transaction. A scan takes about 20 ms at 2,000 contacts and a few hundred ms at 20k, which can exceed the Workers free plan's 10 ms CPU limit for large lists.

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

## Passkeys

Once signed in with the password, add passkeys under **Settings → Passkeys** (Touch ID, Face ID, a phone or a security key). The sign-in screen then offers **Sign in with a passkey**; the password keeps working.

Passkeys are tied to the hostname the app is served from. Behind a reverse proxy that changes the host or scheme, set `APP_URL` to the public URL. Moving to another domain means adding new passkeys.

## API tokens

**Settings → API tokens** creates tokens for programmatic access. Send them as `Authorization: Bearer prm_…` to any `/api/*` route or to `/mcp`. Only a SHA-256 hash is stored, and each token is shown once. Tokens can't create or revoke tokens; that needs a signed-in browser session.

## AI assistants (MCP)

`/mcp` is an [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, stateless, JSON responses) that works on Node and Workers alike. Its tools:

- **Read:** `search_contacts`, `get_contact`, `search_interactions`, `list_reminders`, `reconnect_suggestions`, `prm_overview`
- **Write:** `create_contact`, `update_contact`, `log_interaction`, `create_reminder`, `complete_reminder`

There is deliberately no delete tool.

```bash
# Claude Code
claude mcp add --transport http prm https://prm.example.com/mcp --header "Authorization: Bearer prm_…"
```

Claude Desktop and other clients that expect a local command can use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote); Settings shows the exact config. Clients that require OAuth for remote servers aren't supported yet.

## Phone calls and WhatsApp (Mac connector)

The Mac app below does this natively; the script is for headless use (e.g. a Mac mini) or if you don't run the app.

Call history and WhatsApp chats only exist on your devices, so `connector/mac-sync.ts` reads them on your Mac and pushes timeline entries to `/api/import/interactions` with an API token. It works the same against a VM or Cloudflare deployment.

- **Calls:** answered Phone, FaceTime and CallKit calls (e.g. WhatsApp voice) from `~/Library/Application Support/CallHistoryDB`, which includes iPhone calls when "Calls on other devices" is on. Missed calls are skipped. Callers that are in your Mac contacts become PRM contacts; unknown numbers only link to people you already have.
- **WhatsApp:** from the WhatsApp Mac app's local store. One entry per chat per day ("WhatsApp · 3 messages"), **metadata only, never message text**. People you wrote to become contacts; group members and inbound-only chats only link to existing contacts.
- **Matching:** phone numbers match across formats (`+40 712…` and `0712…` by their last 9 digits, when exactly one contact matches).

```bash
npm run connector -- --dry-run                       # summary only, nothing sent
PRM_URL=https://prm.example.com PRM_TOKEN=prm_… npm run connector
```

It needs **Full Disk Access** for whatever runs it (your terminal app, or `node` under launchd). Progress is kept in `~/.config/prm/connector.json`, so each run sends only what's new (the first run goes back `--since-days`, default 180). It reads copies of the databases and never modifies them.

To run it every 30 minutes, save this as `~/Library/LaunchAgents/com.prm.connector.plist`, then run `launchctl load` on that file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.prm.connector</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/path/to/personalCRM/connector/mac-sync.ts</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PRM_URL</key><string>https://prm.example.com</string>
    <key>PRM_TOKEN</key><string>prm_…</string>
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardErrorPath</key><string>/tmp/prm-connector.log</string>
</dict></plist>
```

Under launchd, grant Full Disk Access to the `node` binary itself.

## Mac app

`macos/` is a native SwiftUI client for the same backend: three columns like Mail, contact pages with the timeline and a log composer, reminders, duplicates review and merge, and built-in calls and WhatsApp sync that replaces the Node connector. It signs in with your password once, then uses its own API token stored in the Keychain. See [macos/README.md](macos/README.md) to build it (needs Xcode).

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
  utils/duplicateScan.ts  Background scan job: lock, fingerprint, stored results
  utils/merge.ts      Atomic contact merge
  utils/google/       OAuth client and resumable sync steps
  tasks/              Scheduled jobs (Google sync, duplicate scan)
  routes/mcp.ts       MCP endpoint (tools in utils/mcpServer.ts)
connector/
  mac-sync.ts         Mac connector: call history and WhatsApp → PRM
src/
  pages/              Home, Contacts, ContactDetail, Reminders, Import
  lib/importers.ts    LinkedIn / Google / generic CSV → contacts (parsed in the browser)
```

### Design notes

- **Identities drive de-duplication.** `contact_identities` has a unique `(kind, value)` index on normalized values: lowercased emails, digit-only phone numbers, LinkedIn handles. Imports match on any of them; manually adding an identity that belongs to someone else returns 409 with that contact's id.
- **No interactive transactions.** D1 doesn't support them from a Worker, so routes do sequential writes and undo by hand where it matters.
- **Imports run in batches of 25** from the browser, which keeps each request well under D1's per-invocation query limit (50 on the free plan).
- **Interactions have `source` + `external_id`** (unique together), so syncs (Gmail thread id, Calendar event id) can re-run without duplicating anything.
- **Auth is single-user:** one `APP_PASSWORD` plus optional passkeys, sealed cookie session. On Cloudflare you can also put the app behind Cloudflare Access.
