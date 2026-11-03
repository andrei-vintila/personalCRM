import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "nitro/h3";
import { z } from "zod";
import { integrations } from "../../../db/schema";
import { useDb } from "../../../utils/db";
import { GoogleApiError } from "../../../utils/google/client";
import { backfillDays, requireGoogleConfig } from "../../../utils/google/http";
import { runGoogleSyncStep, syncKinds } from "../../../utils/google/sync";

/** Runs one resumable sync step; the client repeats until `done`. */
export default defineHandler(async (event) => {
  const { kind } = await readValidatedBody(event, z.object({ kind: z.enum(syncKinds) }));
  const db = await useDb(event);
  const integration = await db.query.integrations.findFirst({ where: eq(integrations.id, getRouterParam(event, "id")!) });
  if (!integration) throw new HTTPError({ status: 404, message: "Integration not found" });

  try {
    return await runGoogleSyncStep(db, requireGoogleConfig(event), integration, kind, { backfillDays: backfillDays(event) });
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    if (error instanceof GoogleApiError && error.rateLimited) {
      throw new HTTPError({ status: 429, message: "Google's rate limit was reached", data: { retryAfterSeconds: 60 } });
    }
    throw new HTTPError({ status: 502, message: error instanceof Error ? error.message : "Sync failed" });
  }
});
