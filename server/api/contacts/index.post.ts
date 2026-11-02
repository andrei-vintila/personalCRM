import { eq } from "drizzle-orm";
import { defineHandler, readValidatedBody } from "nitro/h3";
import { contacts } from "../../db/schema";
import { getContactDetail, setIdentities, setTags } from "../../utils/contacts";
import { useDb } from "../../utils/db";
import { contactInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const { identities, tags, ...fields } = await readValidatedBody(event, contactInputSchema);
  const db = await useDb(event);

  const [contact] = await db.insert(contacts).values(fields).returning({ id: contacts.id });
  try {
    if (identities) await setIdentities(db, contact.id, identities);
  } catch (error) {
    // No transactions on D1 from a Worker: undo the insert by hand.
    await db.delete(contacts).where(eq(contacts.id, contact.id));
    throw error;
  }
  if (tags) await setTags(db, contact.id, tags);

  event.res.status = 201;
  return getContactDetail(db, contact.id);
});
