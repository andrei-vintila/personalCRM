import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "nitro/h3";
import { z } from "zod";
import { integrations } from "../../db/schema";
import { useDb } from "../../utils/db";

/** Pause or resume background sync for an account. */
export default defineHandler(async (event) => {
  const { enabled } = await readValidatedBody(event, z.object({ enabled: z.boolean() }));
  const db = await useDb(event);
  const [row] = await db
    .update(integrations)
    .set({ enabled })
    .where(eq(integrations.id, getRouterParam(event, "id")!))
    .returning({ id: integrations.id, enabled: integrations.enabled });
  if (!row) throw new HTTPError({ status: 404, message: "Integration not found" });
  return row;
});
