import { and, eq, inArray, sql } from "drizzle-orm";
import { contactIdentities, contacts, contactTags, interactionContacts, interactions, tags, type IdentityKind, type InteractionType } from "../db/schema";
import { refreshLastInteraction } from "./contacts";
import { chunk, insertChunks, type DB } from "./db";
import { normalizeIdentity } from "./identity";

/**
 * Bulk ingestion shared by CSV import and integrations. Everything here is
 * idempotent and written to keep the number of statements per call small,
 * because D1 caps queries per Worker invocation.
 */

export interface IncomingContact {
  name: string;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  about?: string | null;
  birthday?: string | null;
  avatarUrl?: string | null;
  identities: { kind: IdentityKind; value: string }[];
}

/**
 * Find-or-create contacts, matching on any known identity. Existing contacts only
 * get blank fields filled and new identities added; nothing typed by hand is overwritten.
 */
export async function importContacts(db: DB, opts: { source: string; tag?: string | null; rows: IncomingContact[] }) {
  const prepared = opts.rows.map((row) => ({
    ...row,
    identities: dedupeIdentities(row.identities.map((i) => ({ kind: i.kind, value: normalizeIdentity(i.kind, i.value) }))),
  }));

  const owners = await lookupIdentityOwners(
    db,
    prepared.flatMap((r) => r.identities.map((i) => i.value)),
  );

  const newContacts: (typeof contacts.$inferInsert & { id: string })[] = [];
  const newIdentities: (typeof contactIdentities.$inferInsert)[] = [];
  const matched = new Map<string, (typeof prepared)[number]>();
  const touched = new Set<string>();

  // Phones stored in another format (0712… vs +40712…) still identify the same person.
  const phoneOwners = await lookupPhoneOwnersBySuffix(
    db,
    prepared.flatMap((r) => r.identities.filter((i) => i.kind === "phone" && !owners.has(`phone:${i.value}`)).map((i) => i.value)),
  );

  for (const row of prepared) {
    let contactId =
      row.identities.map((i) => owners.get(`${i.kind}:${i.value}`)).find(Boolean) ??
      row.identities.filter((i) => i.kind === "phone").map((i) => phoneOwners.get(phoneSuffix(i.value) ?? "")).find(Boolean);
    if (contactId) {
      matched.set(contactId, row);
    } else {
      contactId = crypto.randomUUID();
      newContacts.push({
        id: contactId,
        name: row.name,
        company: row.company ?? null,
        title: row.title ?? null,
        location: row.location ?? null,
        about: row.about ?? null,
        birthday: row.birthday ?? null,
        avatarUrl: row.avatarUrl ?? null,
        source: opts.source,
      });
    }
    touched.add(contactId);
    for (const identity of row.identities) {
      const key = `${identity.kind}:${identity.value}`;
      if (owners.has(key)) continue;
      owners.set(key, contactId);
      newIdentities.push({ ...identity, contactId, source: opts.source });
    }
  }

  for (const batch of insertChunks(contacts, newContacts)) await db.insert(contacts).values(batch);
  for (const batch of insertChunks(contactIdentities, newIdentities)) await db.insert(contactIdentities).values(batch).onConflictDoNothing();

  // Fill blank fields on matched contacts, but only issue updates where something changes.
  for (const ids of chunk([...matched.keys()], 90)) {
    const existing = await db
      .select({
        id: contacts.id,
        company: contacts.company,
        title: contacts.title,
        location: contacts.location,
        birthday: contacts.birthday,
        avatarUrl: contacts.avatarUrl,
      })
      .from(contacts)
      .where(inArray(contacts.id, ids));
    for (const current of existing) {
      const row = matched.get(current.id)!;
      const fill: Partial<typeof contacts.$inferInsert> = {};
      for (const key of ["company", "title", "location", "birthday", "avatarUrl"] as const) {
        if (!current[key] && row[key]) fill[key] = row[key];
      }
      if (Object.keys(fill).length > 0) await db.update(contacts).set(fill).where(eq(contacts.id, current.id));
    }
  }

  if (opts.tag) await tagContacts(db, [...touched], opts.tag);

  return { created: newContacts.length, updated: matched.size, contactIds: [...touched] };
}

export interface Participant {
  kind: IdentityKind;
  value: string;
  name?: string | null;
  /** Create a contact if nobody has this identity yet. */
  create: boolean;
}

/**
 * Maps identities (email, LinkedIn URL, ...) to contact ids, creating contacts for
 * participants marked `create` (e.g. people you emailed, met or messaged).
 * Returns a lookup that normalizes its input, plus how many contacts were created.
 */
export async function resolveParticipants(db: DB, participants: Participant[], source: string) {
  const byKey = new Map<string, Participant>();
  for (const p of participants) {
    const value = normalizeIdentity(p.kind, p.value);
    if (!value || (p.kind === "email" && (!value.includes("@") || isAutomatedAddress(value)))) continue;
    const key = `${p.kind}:${value}`;
    const prev = byKey.get(key);
    byKey.set(key, { kind: p.kind, value, name: prev?.name || p.name, create: Boolean(prev?.create || p.create) });
  }

  const result = await lookupIdentityOwners(
    db,
    [...byKey.values()].map((p) => p.value),
  );
  const phoneOwners = await lookupPhoneOwnersBySuffix(
    db,
    [...byKey.entries()].filter(([key, p]) => p.kind === "phone" && !result.has(key)).map(([, p]) => p.value),
  );
  for (const [key, p] of byKey) {
    const owner = p.kind === "phone" && !result.has(key) ? phoneOwners.get(phoneSuffix(p.value) ?? "") : undefined;
    if (owner) result.set(key, owner);
  }
  const toCreate: IncomingContact[] = [];
  for (const [key, p] of byKey) {
    if (result.has(key) || !p.create) continue;
    const name = p.name?.trim() || (p.kind === "email" ? nameFromEmail(p.value) : p.value);
    toCreate.push({ name, identities: [{ kind: p.kind, value: p.value }] });
  }

  let created = 0;
  if (toCreate.length > 0) {
    ({ created } = await importContacts(db, { source, rows: toCreate }));
    const createdOwners = await lookupIdentityOwners(
      db,
      toCreate.map((c) => c.identities[0].value),
    );
    for (const [key, contactId] of createdOwners) result.set(key, contactId);
  }

  const contactFor = (kind: IdentityKind, value: string) => result.get(`${kind}:${normalizeIdentity(kind, value)}`);
  return { contactFor, created };
}

export interface IncomingInteraction {
  source: string;
  externalId: string;
  type: InteractionType;
  occurredAt: Date;
  title?: string | null;
  body?: string | null;
  contactIds: string[];
}

/**
 * Inserts or updates interactions keyed by (source, externalId) and links them to
 * contacts. When an existing row is hit, the newest occurrence wins for date, title
 * and body (e.g. an email thread is represented by its latest message).
 */
export async function upsertInteractions(db: DB, items: IncomingInteraction[]) {
  const withContacts = items.filter((i) => i.contactIds.length > 0);
  if (withContacts.length === 0) return 0;

  const idByKey = new Map<string, string>();
  for (const batch of insertChunks(interactions, withContacts)) {
    const rows = await db
      .insert(interactions)
      .values(
        batch.map((i) => ({
          source: i.source,
          externalId: i.externalId,
          type: i.type,
          occurredAt: i.occurredAt,
          title: i.title ?? null,
          body: i.body ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [interactions.source, interactions.externalId],
        set: {
          title: sql`case when excluded.occurred_at >= ${interactions.occurredAt} then excluded.title else ${interactions.title} end`,
          body: sql`case when excluded.occurred_at >= ${interactions.occurredAt} then excluded.body else ${interactions.body} end`,
          occurredAt: sql`max(excluded.occurred_at, ${interactions.occurredAt})`,
        },
      })
      .returning({ id: interactions.id, source: interactions.source, externalId: interactions.externalId });
    for (const row of rows) idByKey.set(`${row.source}:${row.externalId}`, row.id);
  }

  const links = withContacts.flatMap((i) =>
    [...new Set(i.contactIds)].map((contactId) => ({ interactionId: idByKey.get(`${i.source}:${i.externalId}`)!, contactId })),
  );
  for (const batch of insertChunks(interactionContacts, links)) await db.insert(interactionContacts).values(batch).onConflictDoNothing();

  await refreshLastInteraction(
    db,
    withContacts.flatMap((i) => i.contactIds),
  );
  return withContacts.length;
}

async function tagContacts(db: DB, contactIds: string[], tag: string) {
  await db.insert(tags).values({ name: tag }).onConflictDoNothing();
  const [tagRow] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, tag));
  for (const batch of chunk(contactIds, 45)) {
    await db
      .insert(contactTags)
      .values(batch.map((contactId) => ({ contactId, tagId: tagRow.id })))
      .onConflictDoNothing();
  }
}

/** One lookup for a set of normalized identity values → "kind:value" → contact id. */
async function lookupIdentityOwners(db: DB, values: string[], kind?: IdentityKind) {
  const owners = new Map<string, string>();
  for (const batch of chunk([...new Set(values)], 90)) {
    const found = await db
      .select({ kind: contactIdentities.kind, value: contactIdentities.value, contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(kind ? and(eq(contactIdentities.kind, kind), inArray(contactIdentities.value, batch)) : inArray(contactIdentities.value, batch));
    for (const f of found) owners.set(`${f.kind}:${f.value}`, f.contactId);
  }
  return owners;
}

/** Last 9 digits: the same across national (0712…) and international (+40712…) formats. */
export function phoneSuffix(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/** Finds contacts by phone suffix; suffixes shared by several contacts are ambiguous and skipped. */
async function lookupPhoneOwnersBySuffix(db: DB, phones: string[]) {
  const suffixes = [...new Set(phones.map(phoneSuffix).filter((s): s is string => s !== null))];
  const owners = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const batch of chunk(suffixes, 90)) {
    const found = await db
      .select({ value: contactIdentities.value, contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.kind, "phone"), inArray(sql`substr(${contactIdentities.value}, -9)`, batch)));
    for (const f of found) {
      const suffix = phoneSuffix(f.value)!;
      if (owners.has(suffix) && owners.get(suffix) !== f.contactId) ambiguous.add(suffix);
      owners.set(suffix, f.contactId);
    }
  }
  for (const suffix of ambiguous) owners.delete(suffix);
  return owners;
}

function dedupeIdentities<T extends { kind: string; value: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => i.value && !seen.has(`${i.kind}:${i.value}`) && seen.add(`${i.kind}:${i.value}`));
}

const AUTOMATED_LOCAL_PART = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|calendar-notification|support|info|news(letter)?|hello|team|billing|receipts?)([+._-]|$)/;

/** Skips robots: no-reply senders, notification relays, calendar resources. */
export function isAutomatedAddress(email: string) {
  const [local, domain = ""] = email.split("@");
  return (
    AUTOMATED_LOCAL_PART.test(local) ||
    domain.endsWith("resource.calendar.google.com") ||
    domain.endsWith("group.calendar.google.com") ||
    domain === "calendar.google.com"
  );
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0].replace(/\+.*$/, "");
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
