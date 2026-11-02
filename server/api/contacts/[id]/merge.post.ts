import { defineHandler, getRouterParam, readValidatedBody } from "nitro/h3";
import { deleteOrphanTags, getContactDetail } from "../../../utils/contacts";
import { useDb } from "../../../utils/db";
import { mergeContacts } from "../../../utils/merge";
import { mergeSchema } from "../../../utils/validation";

/** Merges other contacts into this one; returns the merged contact. */
export default defineHandler(async (event) => {
  const targetId = getRouterParam(event, "id")!;
  const { sourceIds, fields } = await readValidatedBody(event, mergeSchema);
  const db = await useDb(event);
  await mergeContacts(db, targetId, sourceIds, fields);
  await deleteOrphanTags(db);
  return getContactDetail(db, targetId);
});
