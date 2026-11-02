import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, readValidatedBody } from "nitro/h3";
import { contacts } from "../../db/schema";
import { deleteOrphanTags, getContactDetail, setIdentities, setTags } from "../../utils/contacts";
import { useDb } from "../../utils/db";
import { contactPatchSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const { identities, tags, ...fields } = await readValidatedBody(event, contactPatchSchema);
  const db = await useDb(event);

  // 404s early if the contact does not exist.
  await getContactDetail(db, id);

  if (identities) await setIdentities(db, id, identities);
  if (Object.keys(fields).length > 0) {
    await db.update(contacts).set(fields).where(eq(contacts.id, id));
  }
  if (tags) {
    await setTags(db, id, tags);
    await deleteOrphanTags(db);
  }
  return getContactDetail(db, id);
});
