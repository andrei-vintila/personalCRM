import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { apiTokens } from "../../db/schema";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const db = await useDb(event);
  await db.delete(apiTokens).where(eq(apiTokens.id, getRouterParam(event, "id")!));
  return noContent();
});
