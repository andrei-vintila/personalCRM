import { eq, inArray, sql } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import { contactIdentities, contacts, contactTags, interactionContacts, reminders } from "../db/schema";
import { runBatch, type DB } from "./db";

export const mergeableFields = ["name", "company", "title", "location", "avatarUrl", "birthday", "about"] as const;
export type MergeableField = (typeof mergeableFields)[number];

/**
 * Merges `sourceIds` into `targetId` in one transaction:
 * identities, reminders, tags and timeline move to the target; then sources are deleted.
 * Field values come from `choices` when given, else the target's, else the first source's.
 */
export async function mergeContacts(
  db: DB,
  targetId: string,
  sourceIds: string[],
  choices: Partial<Record<MergeableField, string | null>> = {},
) {
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (sources.length === 0) throw new HTTPError({ status: 400, message: "Pick at least one other contact to merge" });

  const rows = await db.select().from(contacts).where(inArray(contacts.id, [targetId, ...sources]));
  const target = rows.find((r) => r.id === targetId);
  if (!target || rows.length !== sources.length + 1) throw new HTTPError({ status: 404, message: "Contact not found" });
  const others = sources.map((id) => rows.find((r) => r.id === id)!);
  const all = [target, ...others];

  const merged: Partial<typeof contacts.$inferInsert> = {};
  for (const field of mergeableFields) {
    if (field in choices) merged[field] = (choices[field] ?? null) as never;
    else if (field === "about") {
      // Notes are concatenated rather than dropped.
      const notes = [...new Set(all.map((r) => r.about?.trim()).filter(Boolean))];
      merged.about = notes.length ? notes.join("\n\n") : null;
    } else merged[field] = (target[field] ?? others.find((o) => o[field])?.[field] ?? null) as never;
  }
  if (!merged.name) merged.name = target.name;
  const cadences = all.map((r) => r.keepInTouchDays).filter((d): d is number => d !== null);
  merged.keepInTouchDays = cadences.length ? Math.min(...cadences) : null;
  merged.starred = all.some((r) => r.starred);
  merged.archived = all.every((r) => r.archived);
  merged.createdAt = new Date(Math.min(...all.map((r) => r.createdAt.getTime())));

  await runBatch(db, [
    db.update(contacts).set(merged).where(eq(contacts.id, targetId)),
    db.update(contactIdentities).set({ contactId: targetId }).where(inArray(contactIdentities.contactId, sources)),
    db.update(reminders).set({ contactId: targetId }).where(inArray(reminders.contactId, sources)),
    // Query-builder insert…select rather than db.run(sql): Drizzle's D1 batch can't bind raw statements.
    db
      .insert(contactTags)
      .select(
        db
          .select({ contactId: sql<string>`${targetId}`.as("contact_id"), tagId: contactTags.tagId })
          .from(contactTags)
          .where(inArray(contactTags.contactId, sources)),
      )
      .onConflictDoNothing(),
    db
      .insert(interactionContacts)
      .select(
        db
          .select({ interactionId: interactionContacts.interactionId, contactId: sql<string>`${targetId}`.as("contact_id") })
          .from(interactionContacts)
          .where(inArray(interactionContacts.contactId, sources)),
      )
      .onConflictDoNothing(),
    // Cascades remove the sources' leftover tag links, timeline links and dismissals.
    db.delete(contacts).where(inArray(contacts.id, sources)),
    db
      .update(contacts)
      .set({
        lastInteractionAt: sql`(select max(i.occurred_at) from interactions i inner join interaction_contacts ic on ic.interaction_id = i.id where ic.contact_id = ${contacts.id})`,
      })
      .where(eq(contacts.id, targetId)),
  ]);
}
