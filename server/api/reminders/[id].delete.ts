import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { reminders } from "../../db/schema";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const db = await useDb(event);
  await db.delete(reminders).where(eq(reminders.id, getRouterParam(event, "id")!));
  return noContent();
});
