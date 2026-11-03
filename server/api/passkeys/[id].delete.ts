import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { passkeys } from "../../db/schema";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const db = await useDb(event);
  await db.delete(passkeys).where(eq(passkeys.id, getRouterParam(event, "id")!));
  return noContent();
});
