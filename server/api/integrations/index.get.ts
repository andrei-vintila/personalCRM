import { asc } from "drizzle-orm";
import { defineHandler } from "nitro/h3";
import { integrations } from "../../db/schema";
import { useDb } from "../../utils/db";
import { getEnv } from "../../utils/env";
import { googleConfig } from "../../utils/google/client";
import { googleRedirectUri } from "../../utils/google/http";
import { syncKinds, type GoogleSyncState } from "../../utils/google/sync";

export default defineHandler(async (event) => {
  const db = await useDb(event);
  const rows = await db.select().from(integrations).orderBy(asc(integrations.createdAt));
  return {
    google: {
      configured: Boolean(googleConfig((key) => getEnv(event, key))),
      redirectUri: googleRedirectUri(event),
    },
    accounts: rows.map((row) => {
      const state = row.state as GoogleSyncState;
      return {
        id: row.id,
        provider: row.provider,
        accountEmail: row.accountEmail,
        enabled: row.enabled,
        lastSyncedAt: row.lastSyncedAt,
        lastError: row.lastError,
        createdAt: row.createdAt,
        sources: syncKinds.map((kind) => ({
          kind,
          initialDone: Boolean(state[kind]?.initialDone),
          lastRunAt: state[kind]?.lastRunAt ?? null,
        })),
      };
    }),
  };
});
