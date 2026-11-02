import { eq } from "drizzle-orm";
import { defineHandler, getRouterParam, noContent } from "nitro/h3";
import { integrations } from "../../db/schema";
import { decryptSecret } from "../../utils/crypto";
import { useDb } from "../../utils/db";
import { getEnv } from "../../utils/env";
import { googleConfig, googleUrl } from "../../utils/google/client";

/** Disconnects the account and revokes its Google grant. Synced contacts and interactions stay. */
export default defineHandler(async (event) => {
  const db = await useDb(event);
  const id = getRouterParam(event, "id")!;
  const integration = await db.query.integrations.findFirst({ where: eq(integrations.id, id) });
  const config = googleConfig((key) => getEnv(event, key));

  if (integration && config) {
    try {
      const token = await decryptSecret(integration.refreshToken, config.clientSecret);
      await fetch(googleUrl(config, "oauth2.googleapis.com", "/revoke"), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Best effort: the row is removed either way.
    }
  }
  await db.delete(integrations).where(eq(integrations.id, id));
  return noContent();
});
