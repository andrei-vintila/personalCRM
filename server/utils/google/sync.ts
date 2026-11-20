import { eq } from "drizzle-orm";
import { integrations, type Integration } from "../../db/schema";
import type { DB } from "../db";
import { importContacts, resolveParticipants, upsertInteractions, type IncomingContact, type IncomingInteraction, type Participant } from "../ingest";
import { accessTokenFor, GoogleApiError, googleJson, gmailBatchGet, type GoogleConfig } from "./client";

/**
 * Google sync runs as small resumable steps: each call handles one page from one
 * source and stores a cursor in integrations.state. The UI calls steps in a loop
 * for the initial backfill; the scheduled task runs one step per tick afterwards.
 * Page sizes keep a step within Workers' free-plan limits (50 subrequests, 50 D1 queries).
 */

export const syncKinds = ["contacts", "calendar", "gmail"] as const;
export type SyncKind = (typeof syncKinds)[number];

export interface GoogleSyncState {
  contacts?: { syncToken?: string; pageToken?: string; initialDone?: boolean; lastRunAt?: number };
  gmail?: {
    /** internalDate (ms) of the newest message fully processed */
    highWater?: number;
    pass?: { pageToken?: string; floor: number; newest: number };
    initialDone?: boolean;
    lastRunAt?: number;
  };
  calendar?: {
    since?: number;
    pass?: { pageToken?: string; timeMin: number; timeMax: number };
    initialDone?: boolean;
    lastRunAt?: number;
  };
}

export interface StepResult {
  kind: SyncKind;
  done: boolean;
  processed: number;
  contactsCreated: number;
  interactions: number;
}

interface StepContext {
  db: DB;
  config: GoogleConfig;
  token: string;
  state: GoogleSyncState;
  ownEmails: Set<string>;
  backfillDays: number;
}

const DAY_MS = 86_400_000;

export async function runGoogleSyncStep(
  db: DB,
  config: GoogleConfig,
  integration: Integration,
  kind: SyncKind,
  opts: { backfillDays?: number } = {},
): Promise<StepResult> {
  const accounts = await db.select({ email: integrations.accountEmail }).from(integrations);
  const state = structuredClone(integration.state ?? {}) as GoogleSyncState;
  const ctx: StepContext = {
    db,
    config,
    state,
    token: "",
    ownEmails: new Set(accounts.map((a) => a.email.toLowerCase())),
    backfillDays: opts.backfillDays ?? 180,
  };

  let result: Omit<StepResult, "kind">;
  try {
    ctx.token = await accessTokenFor(db, config, integration);
    try {
      result = await steps[kind](ctx);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.status === 401)) throw error;
      ctx.token = await accessTokenFor(db, config, integration, true);
      result = await steps[kind](ctx);
    }
  } catch (error) {
    const message =
      error instanceof GoogleApiError && /invalid_grant|expired or revoked/i.test(error.message)
        ? "Google access expired or was revoked. Reconnect the account."
        : error instanceof GoogleApiError && error.rateLimited
          ? "Google's rate limit was reached. Sync picks up where it stopped in a minute or two."
          : error instanceof Error
            ? error.message
            : String(error);
    await db.update(integrations).set({ lastError: `${kind}: ${message}` }).where(eq(integrations.id, integration.id));
    throw error;
  }

  (state[kind] ??= {}).lastRunAt = Date.now();
  await db
    .update(integrations)
    .set({ state: state as Record<string, unknown>, lastSyncedAt: new Date(), lastError: null })
    .where(eq(integrations.id, integration.id));
  return { kind, ...result };
}

const steps: Record<SyncKind, (ctx: StepContext) => Promise<Omit<StepResult, "kind">>> = {
  contacts: syncContactsStep,
  calendar: syncCalendarStep,
  gmail: syncGmailStep,
};

// ---------------------------------------------------------------------------
// Google Contacts (People API)

interface Person {
  metadata?: { deleted?: boolean };
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
  organizations?: { name?: string; title?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[];
  urls?: { value?: string }[];
  photos?: { url?: string; default?: boolean }[];
  biographies?: { value?: string }[];
  addresses?: { city?: string; country?: string }[];
}

async function syncContactsStep(ctx: StepContext) {
  const s = (ctx.state.contacts ??= {});
  let page: { connections?: Person[]; nextPageToken?: string; nextSyncToken?: string };
  try {
    page = await googleJson(ctx.config, ctx.token, "people.googleapis.com", "/v1/people/me/connections", {
      personFields: "names,emailAddresses,phoneNumbers,organizations,birthdays,urls,photos,biographies,addresses,metadata",
      pageSize: 50,
      requestSyncToken: true,
      syncToken: s.syncToken,
      pageToken: s.pageToken,
    });
  } catch (error) {
    // Sync tokens expire after 7 days; start a fresh full pass.
    if (error instanceof GoogleApiError && error.syncTokenExpired) {
      ctx.state.contacts = { initialDone: s.initialDone };
      return { done: false, processed: 0, contactsCreated: 0, interactions: 0 };
    }
    throw error;
  }

  const rows = (page.connections ?? []).filter((p) => !p.metadata?.deleted).map(personToContact).filter((c): c is IncomingContact => c !== null);
  const { created } = rows.length ? await importContacts(ctx.db, { source: "google", rows }) : { created: 0 };

  if (page.nextPageToken) {
    s.pageToken = page.nextPageToken;
  } else {
    s.pageToken = undefined;
    s.syncToken = page.nextSyncToken ?? s.syncToken;
    s.initialDone = true;
  }
  return { done: !page.nextPageToken, processed: rows.length, contactsCreated: created, interactions: 0 };
}

function personToContact(p: Person): IncomingContact | null {
  const emails = (p.emailAddresses ?? []).map((e) => e.value).filter((v): v is string => Boolean(v));
  const name = p.names?.[0]?.displayName?.trim() || p.organizations?.[0]?.name || emails[0];
  if (!name) return null;

  const birthday = p.birthdays?.find((b) => b.date?.month && b.date?.day)?.date;
  const pad = (n: number) => String(n).padStart(2, "0");
  const city = p.addresses?.find((a) => a.city)?.city;

  return {
    name,
    company: p.organizations?.[0]?.name ?? null,
    title: p.organizations?.[0]?.title ?? null,
    location: city ?? null,
    about: p.biographies?.[0]?.value ?? null,
    avatarUrl: p.photos?.find((ph) => ph.url && !ph.default)?.url ?? null,
    birthday: birthday ? `${birthday.year ?? "-"}-${pad(birthday.month!)}-${pad(birthday.day!)}` : null,
    identities: [
      ...emails.map((value) => ({ kind: "email" as const, value })),
      ...(p.phoneNumbers ?? [])
        .map((ph) => ph.canonicalForm ?? ph.value)
        .filter((v): v is string => Boolean(v))
        .map((value) => ({ kind: "phone" as const, value })),
      ...(p.urls ?? [])
        .map((u) => u.value)
        .filter((v): v is string => Boolean(v))
        .map((value) => ({ kind: /linkedin\.com\/in\//i.test(value) ? ("linkedin" as const) : ("url" as const), value })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Google Calendar: past meetings with other people become "meeting" interactions.

interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
}

const MAX_MEETING_SIZE = 15;

async function syncCalendarStep(ctx: StepContext) {
  const s = (ctx.state.calendar ??= {});
  const now = Date.now();
  s.pass ??= { timeMin: s.since ?? now - ctx.backfillDays * DAY_MS, timeMax: now };

  const page = await googleJson<{ items?: CalendarEvent[]; nextPageToken?: string }>(
    ctx.config,
    ctx.token,
    "www.googleapis.com",
    "/calendar/v3/calendars/primary/events",
    {
      singleEvents: true,
      orderBy: "startTime",
      timeMin: new Date(s.pass.timeMin).toISOString(),
      timeMax: new Date(s.pass.timeMax).toISOString(),
      maxResults: 50,
      pageToken: s.pass.pageToken,
    },
  );

  const meetings: { event: CalendarEvent; others: Participant[] }[] = [];
  for (const event of page.items ?? []) {
    if (event.status === "cancelled" || !event.start?.dateTime || !event.attendees) continue;
    if (event.attendees.length > MAX_MEETING_SIZE) continue;
    if (event.attendees.find((a) => a.self)?.responseStatus === "declined") continue;
    const others = event.attendees
      .filter((a) => a.email && !a.self && !a.resource && a.responseStatus !== "declined" && !ctx.ownEmails.has(a.email.toLowerCase()))
      .map((a) => ({ kind: "email" as const, value: a.email!, name: a.displayName, create: true }));
    if (others.length > 0) meetings.push({ event, others });
  }

  const { contactFor, created } = await resolveParticipants(
    ctx.db,
    meetings.flatMap((m) => m.others),
    "gcal",
  );
  const items: IncomingInteraction[] = meetings.map(({ event, others }) => ({
    source: "gcal",
    externalId: event.id,
    type: "meeting",
    occurredAt: new Date(event.start!.dateTime!),
    title: event.summary ?? "Meeting",
    contactIds: others.map((o) => contactFor("email", o.value)).filter((id): id is string => Boolean(id)),
  }));
  const written = await upsertInteractions(ctx.db, items);

  if (page.nextPageToken) {
    s.pass.pageToken = page.nextPageToken;
  } else {
    s.since = s.pass.timeMax;
    s.pass = undefined;
    s.initialDone = true;
  }
  return { done: !page.nextPageToken, processed: page.items?.length ?? 0, contactsCreated: created, interactions: written };
}

// ---------------------------------------------------------------------------
// Gmail: one "email" interaction per thread, linked to the people in it.
// People you wrote to become contacts; received mail only links to existing contacts.

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string;
  payload?: { headers?: { name: string; value: string }[] };
}

const SKIP_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "CHAT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);
const GMAIL_PAGE = 25;
const MAX_RECIPIENTS_TO_CREATE = 10;

async function syncGmailStep(ctx: StepContext) {
  const s = (ctx.state.gmail ??= {});
  const floor = s.highWater ?? Date.now() - ctx.backfillDays * DAY_MS;
  s.pass ??= { floor, newest: floor };

  const list = await googleJson<{ messages?: { id: string }[]; nextPageToken?: string }>(
    ctx.config,
    ctx.token,
    "gmail.googleapis.com",
    "/gmail/v1/users/me/messages",
    { maxResults: GMAIL_PAGE, pageToken: s.pass.pageToken, includeSpamTrash: false },
  );
  const headers = ["From", "To", "Cc", "Subject", "List-Unsubscribe"].map((h) => `metadataHeaders=${h}`).join("&");
  const messages = await gmailBatchGet<GmailMessage>(
    ctx.config,
    ctx.token,
    (list.messages ?? []).map((m) => `/gmail/v1/users/me/messages/${m.id}?format=metadata&${headers}`),
  );

  // Messages come newest first; stop at the previous high-water mark.
  let reachedFloor = false;
  const threads = new Map<string, { latest: GmailMessage; at: number; participants: Participant[] }>();
  for (const message of messages) {
    if (!message) continue;
    const at = Number(message.internalDate);
    if (at <= s.pass.floor) {
      reachedFloor = true;
      break;
    }
    s.pass.newest = Math.max(s.pass.newest, at);

    const labels = new Set(message.labelIds ?? []);
    if ([...labels].some((l) => SKIP_LABELS.has(l))) continue;
    const header = (name: string) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    const sent = labels.has("SENT");
    if (!sent && header("List-Unsubscribe")) continue;

    const recipients = [...parseAddressList(header("To")), ...parseAddressList(header("Cc"))];
    const people: Participant[] = [
      ...parseAddressList(header("From")).map((p) => ({ kind: "email" as const, value: p.email, name: p.name, create: false })),
      ...recipients.map((p) => ({
        kind: "email" as const,
        value: p.email,
        name: p.name,
        create: sent && recipients.length <= MAX_RECIPIENTS_TO_CREATE,
      })),
    ].filter((p) => !ctx.ownEmails.has(p.value));
    if (people.length === 0) continue;

    const thread = threads.get(message.threadId);
    if (!thread) threads.set(message.threadId, { latest: message, at, participants: people });
    else {
      thread.participants.push(...people);
      if (at > thread.at) Object.assign(thread, { latest: message, at });
    }
  }

  const { contactFor, created } = await resolveParticipants(
    ctx.db,
    [...threads.values()].flatMap((t) => t.participants),
    "gmail",
  );
  const items: IncomingInteraction[] = [...threads.entries()].map(([threadId, t]) => {
    const subject = t.latest.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value;
    return {
      source: "gmail",
      externalId: threadId,
      type: "email",
      occurredAt: new Date(t.at),
      title: subject?.trim() || "(no subject)",
      body: decodeEntities(t.latest.snippet ?? ""),
      contactIds: t.participants.map((p) => contactFor(p.kind, p.value)).filter((id): id is string => Boolean(id)),
    };
  });
  const written = await upsertInteractions(ctx.db, items);

  const done = reachedFloor || !list.nextPageToken;
  if (done) {
    s.highWater = Math.max(s.highWater ?? 0, s.pass.newest);
    s.pass = undefined;
    s.initialDone = true;
  } else {
    s.pass.pageToken = list.nextPageToken;
  }
  return { done, processed: messages.length, contactsCreated: created, interactions: written };
}

/** Parses `"Name" <a@b.com>, c@d.com` into lowercase emails with display names. */
export function parseAddressList(value: string): { email: string; name: string | null }[] {
  const out: { email: string; name: string | null }[] = [];
  for (const part of value.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
    const angle = part.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    const email = (angle ? angle[2] : part).trim().toLowerCase();
    if (!email.includes("@")) continue;
    const name = angle?.[1]?.replace(/^"|"$/g, "").trim() || null;
    out.push({ email, name: name && !name.includes("@") ? name : null });
  }
  return out;
}

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
