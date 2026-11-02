import { and, asc, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import {
  contactIdentities,
  contacts,
  contactTags,
  interactionContacts,
  interactions,
  reminders,
  tags,
  type IdentityKind,
} from "../db/schema";
import { chunk, type DB } from "./db";
import { normalizeIdentity } from "./identity";

const DAY_MS = 86_400_000;

export type ContactFilter = "all" | "starred" | "reconnect" | "archived";

export interface IdentityInput {
  kind: IdentityKind;
  value: string;
  label?: string | null;
}

// Relational queries (db.query.*) re-alias every column reference in a custom
// `where` to the outer table, so subqueries below name inner tables in raw SQL.

/** SQL expression: ms timestamp when this contact is due for a catch-up. Never-contacted people count from when they were added. */
const dueAtSql = sql<number>`coalesce(${contacts.lastInteractionAt}, ${contacts.createdAt}) + ${contacts.keepInTouchDays} * ${DAY_MS}`;

export async function listContacts(db: DB, opts: { q?: string; tag?: string; filter?: ContactFilter; limit?: number }) {
  const where: SQL[] = [];
  const filter = opts.filter ?? "all";

  where.push(eq(contacts.archived, filter === "archived"));
  if (filter === "starred") where.push(eq(contacts.starred, true));
  if (filter === "reconnect") {
    where.push(isNotNull(contacts.keepInTouchDays), sql`${dueAtSql} <= ${Date.now()}`);
  }

  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, "")}%`;
    where.push(
      or(
        like(contacts.name, pattern),
        like(contacts.company, pattern),
        like(contacts.title, pattern),
        like(contacts.location, pattern),
        sql`exists (select 1 from contact_identities ci where ci.contact_id = ${contacts.id} and ci.value like ${pattern.toLowerCase()})`,
      )!,
    );
  }

  if (opts.tag) {
    where.push(
      sql`exists (select 1 from contact_tags ct inner join tags t on t.id = ct.tag_id where ct.contact_id = ${contacts.id} and t.name = ${opts.tag})`,
    );
  }

  const rows = await db.query.contacts.findMany({
    where: and(...where),
    orderBy: filter === "reconnect" ? [asc(dueAtSql)] : [desc(contacts.starred), asc(sql`lower(${contacts.name})`)],
    limit: opts.limit ?? 500,
    with: {
      identities: { columns: { kind: true, value: true } },
      tags: { with: { tag: { columns: { name: true } } } },
    },
  });

  return rows.map(({ identities, tags: contactTagRows, ...contact }) => ({
    ...contact,
    email: identities.find((i) => i.kind === "email")?.value ?? null,
    phone: identities.find((i) => i.kind === "phone")?.value ?? null,
    tags: contactTagRows.map((t) => t.tag.name).sort(),
    dueAt: dueAt(contact),
  }));
}

export async function getContactDetail(db: DB, id: string) {
  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, id),
    with: {
      identities: { orderBy: [asc(contactIdentities.kind), asc(contactIdentities.createdAt)] },
      tags: { with: { tag: true } },
      reminders: { orderBy: [asc(reminders.completedAt), asc(reminders.dueAt)] },
    },
  });
  if (!contact) throw new HTTPError({ status: 404, message: "Contact not found" });

  const timeline = await listInteractions(db, { contactId: id, limit: 200 });
  const { tags: contactTagRows, ...rest } = contact;
  return {
    ...rest,
    tags: contactTagRows.map((t) => t.tag.name).sort(),
    interactions: timeline,
    dueAt: dueAt(contact),
  };
}

export async function listInteractions(db: DB, opts: { contactId?: string; limit?: number }) {
  const rows = await db.query.interactions.findMany({
    where: opts.contactId
      ? sql`exists (select 1 from interaction_contacts ic where ic.interaction_id = ${interactions.id} and ic.contact_id = ${opts.contactId})`
      : undefined,
    orderBy: [desc(interactions.occurredAt)],
    limit: opts.limit ?? 50,
    with: { contacts: { with: { contact: { columns: { id: true, name: true, avatarUrl: true } } } } },
  });
  return rows.map(({ contacts: links, ...interaction }) => ({
    ...interaction,
    contacts: links.map((l) => l.contact),
  }));
}

/**
 * Replaces a contact's identities. Fails with 409 if an identity already belongs to
 * someone else, which is the signal that the two records should be merged.
 */
export async function setIdentities(db: DB, contactId: string, inputs: IdentityInput[], source = "manual") {
  const normalized = dedupeIdentities(inputs);
  for (const identity of normalized) {
    const owner = await db.query.contactIdentities.findFirst({
      where: and(eq(contactIdentities.kind, identity.kind), eq(contactIdentities.value, identity.value)),
      with: { contact: { columns: { id: true, name: true } } },
    });
    if (owner && owner.contactId !== contactId) {
      throw new HTTPError({
        status: 409,
        message: `${identity.value} already belongs to ${owner.contact.name}`,
        data: { contactId: owner.contactId },
      });
    }
  }

  await db.delete(contactIdentities).where(eq(contactIdentities.contactId, contactId));
  for (const batch of chunk(normalized, 15)) {
    await db.insert(contactIdentities).values(batch.map((i) => ({ ...i, contactId, source })));
  }
}

/** Adds identities that are not yet known anywhere; returns how many were added. */
export async function addMissingIdentities(db: DB, contactId: string, inputs: IdentityInput[], source: string) {
  const normalized = dedupeIdentities(inputs);
  if (normalized.length === 0) return 0;
  const inserted = await db
    .insert(contactIdentities)
    .values(normalized.map((i) => ({ ...i, contactId, source })))
    .onConflictDoNothing()
    .returning({ id: contactIdentities.id });
  return inserted.length;
}

export async function findContactByIdentities(db: DB, inputs: IdentityInput[]) {
  for (const identity of dedupeIdentities(inputs)) {
    const match = await db.query.contactIdentities.findFirst({
      where: and(eq(contactIdentities.kind, identity.kind), eq(contactIdentities.value, identity.value)),
      columns: { contactId: true },
    });
    if (match) return match.contactId;
  }
  return undefined;
}

export async function setTags(db: DB, contactId: string, names: string[]) {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  await db.delete(contactTags).where(eq(contactTags.contactId, contactId));
  if (wanted.length === 0) return;

  await db
    .insert(tags)
    .values(wanted.map((name) => ({ name })))
    .onConflictDoNothing();
  const tagRows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, wanted));
  await db.insert(contactTags).values(tagRows.map((t) => ({ contactId, tagId: t.id })));
}

/** Recomputes contacts.last_interaction_at from the interactions table (one statement per 90 contacts). */
export async function refreshLastInteraction(db: DB, contactIds: string[]) {
  for (const ids of chunk([...new Set(contactIds)], 90)) {
    await db
      .update(contacts)
      .set({
        lastInteractionAt: sql`(select max(i.occurred_at) from interactions i inner join interaction_contacts ic on ic.interaction_id = i.id where ic.contact_id = ${contacts.id})`,
      })
      .where(inArray(contacts.id, ids));
  }
}

export async function listTags(db: DB) {
  return db
    .select({ name: tags.name, count: sql<number>`count(${contactTags.contactId})` })
    .from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
}

export async function deleteOrphanTags(db: DB) {
  await db.delete(tags).where(sql`${tags.id} not in (select ${contactTags.tagId} from ${contactTags})`);
}

function dueAt(contact: { keepInTouchDays: number | null; lastInteractionAt: Date | null; createdAt: Date }) {
  if (!contact.keepInTouchDays) return null;
  return (contact.lastInteractionAt ?? contact.createdAt).getTime() + contact.keepInTouchDays * DAY_MS;
}

function dedupeIdentities(inputs: IdentityInput[]) {
  const seen = new Set<string>();
  const out: { kind: IdentityKind; value: string; label: string | null }[] = [];
  for (const input of inputs) {
    if (!input.value?.trim()) continue;
    const value = normalizeIdentity(input.kind, input.value);
    const key = `${input.kind}:${value}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: input.kind, value, label: input.label ?? null });
  }
  return out;
}
