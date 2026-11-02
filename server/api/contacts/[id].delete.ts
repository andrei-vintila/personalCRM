import { eq, sql } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { contacts, interactionContacts, interactions } from "../../db/schema";
import { deleteOrphanTags } from "../../utils/contacts";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const db = await useDb(event);
  await db.delete(contacts).where(eq(contacts.id, id));
  // Interactions that no longer involve anyone are dropped with the contact.
  await db
    .delete(interactions)
    .where(sql`${interactions.id} not in (select ${interactionContacts.interactionId} from ${interactionContacts})`);
  await deleteOrphanTags(db);
  return noContent();
});
