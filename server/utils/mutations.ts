import { eq, inArray } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import type { z } from "zod";
import { contacts, interactionContacts, interactions, reminders } from "../db/schema";
import { deleteOrphanTags, getContactDetail, refreshLastInteraction, setIdentities, setTags } from "./contacts";
import type { DB } from "./db";
import type { contactInputSchema, contactPatchSchema, interactionInputSchema, reminderInputSchema } from "./validation";

/** Writes shared by the REST API and the MCP server. */

export async function createContact(db: DB, input: z.infer<typeof contactInputSchema>) {
  const { identities, tags, ...fields } = input;
  const [contact] = await db.insert(contacts).values(fields).returning({ id: contacts.id });
  try {
    if (identities) await setIdentities(db, contact.id, identities);
  } catch (error) {
    // No transactions on D1 from a Worker: undo the insert by hand.
    await db.delete(contacts).where(eq(contacts.id, contact.id));
    throw error;
  }
  if (tags) await setTags(db, contact.id, tags);
  return getContactDetail(db, contact.id);
}

export async function updateContact(db: DB, id: string, input: z.infer<typeof contactPatchSchema>) {
  const { identities, tags, ...fields } = input;
  // 404s early if the contact does not exist.
  await getContactDetail(db, id);

  if (identities) await setIdentities(db, id, identities);
  if (Object.keys(fields).length > 0) await db.update(contacts).set(fields).where(eq(contacts.id, id));
  if (tags) {
    await setTags(db, id, tags);
    await deleteOrphanTags(db);
  }
  return getContactDetail(db, id);
}

export async function logInteraction(db: DB, input: z.infer<typeof interactionInputSchema>) {
  const { contactIds, occurredAt, ...fields } = input;
  const ids = [...new Set(contactIds)];
  const found = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
  if (found.length !== ids.length) throw new HTTPError({ status: 400, message: "Unknown contact id" });

  const [interaction] = await db
    .insert(interactions)
    .values({ ...fields, occurredAt: occurredAt ?? new Date() })
    .returning();
  await db.insert(interactionContacts).values(ids.map((contactId) => ({ interactionId: interaction.id, contactId })));
  await refreshLastInteraction(db, ids);
  return interaction;
}

export async function createReminder(db: DB, input: z.infer<typeof reminderInputSchema>) {
  const [reminder] = await db
    .insert(reminders)
    .values({ ...input, contactId: input.contactId ?? null })
    .returning();
  return reminder;
}
