import { inArray } from "drizzle-orm";
import { defineHandler, HTTPError, readValidatedBody } from "nitro/h3";
import { contacts, interactionContacts, interactions } from "../../db/schema";
import { refreshLastInteraction } from "../../utils/contacts";
import { useDb } from "../../utils/db";
import { interactionInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const { contactIds, occurredAt, ...fields } = await readValidatedBody(event, interactionInputSchema);
  const db = await useDb(event);

  const ids = [...new Set(contactIds)];
  const found = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
  if (found.length !== ids.length) throw new HTTPError({ status: 400, message: "Unknown contact id" });

  const [interaction] = await db
    .insert(interactions)
    .values({ ...fields, occurredAt: occurredAt ?? new Date() })
    .returning();
  await db.insert(interactionContacts).values(ids.map((contactId) => ({ interactionId: interaction.id, contactId })));
  await refreshLastInteraction(db, ids);

  event.res.status = 201;
  return interaction;
});
