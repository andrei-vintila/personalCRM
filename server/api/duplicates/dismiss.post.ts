import { defineHandler, readValidatedBody } from "nitro/h3";
import { duplicateDismissals } from "../../db/schema";
import { useDb } from "../../utils/db";
import { dismissSchema } from "../../utils/validation";

/** "Not the same person": hides the pair from future duplicate checks. */
export default defineHandler(async (event) => {
  const { contactIds } = await readValidatedBody(event, dismissSchema);
  const [contactA, contactB] = [...contactIds].sort();
  const db = await useDb(event);
  await db.insert(duplicateDismissals).values({ contactA, contactB }).onConflictDoNothing();
  return { dismissed: true };
});
