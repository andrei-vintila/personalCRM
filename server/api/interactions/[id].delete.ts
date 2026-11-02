import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { interactionContacts, interactions } from "../../db/schema";
import { refreshLastInteraction } from "../../utils/contacts";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const db = await useDb(event);
  const links = await db
    .select({ contactId: interactionContacts.contactId })
    .from(interactionContacts)
    .where(eq(interactionContacts.interactionId, id));
  await db.delete(interactions).where(eq(interactions.id, id));
  await refreshLastInteraction(
    db,
    links.map((l) => l.contactId),
  );
  return noContent();
});
