import { desc } from "drizzle-orm";
import { defineHandler } from "nitro/h3";
import { apiTokens } from "../../db/schema";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const db = await useDb(event);
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt));
});
