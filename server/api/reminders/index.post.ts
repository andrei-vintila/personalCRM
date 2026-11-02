import { defineHandler, readValidatedBody } from "nitro/h3";
import { reminders } from "../../db/schema";
import { useDb } from "../../utils/db";
import { reminderInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const input = await readValidatedBody(event, reminderInputSchema);
  const db = await useDb(event);
  const [reminder] = await db
    .insert(reminders)
    .values({ ...input, contactId: input.contactId ?? null })
    .returning();
  event.res.status = 201;
  return reminder;
});
