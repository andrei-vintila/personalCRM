import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "nitro/h3";
import { reminders } from "../../db/schema";
import { useDb } from "../../utils/db";
import { reminderPatchSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const { completed, ...fields } = await readValidatedBody(event, reminderPatchSchema);
  const db = await useDb(event);
  const [reminder] = await db
    .update(reminders)
    .set({ ...fields, ...(completed === undefined ? {} : { completedAt: completed ? new Date() : null }) })
    .where(eq(reminders.id, id))
    .returning();
  if (!reminder) throw new HTTPError({ status: 404, message: "Reminder not found" });
  return reminder;
});
