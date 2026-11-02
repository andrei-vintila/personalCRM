import { eq } from "drizzle-orm";
import { defineTask } from "nitro/task";
import { integrations } from "../../db/schema";
import { getDb } from "../../utils/db";
import { readEnv, type CloudflareBindings } from "../../utils/env";
import { googleConfig } from "../../utils/google/client";
import { runGoogleSyncStep, syncKinds, type StepResult } from "../../utils/google/sync";

/**
 * Scheduled incremental sync. Each tick runs one source per account (rotating),
 * which keeps a Worker invocation within free-plan subrequest and D1 query limits.
 * Initial backfills are driven from the Settings page instead.
 */
export default defineTask<StepResult[]>({
  meta: { name: "google:sync", description: "Incremental sync of connected Google accounts" },
  async run({ context }) {
    const bindings = (context as { cloudflare?: { env?: CloudflareBindings } }).cloudflare?.env;
    const config = googleConfig((key) => readEnv(bindings, key));
    if (!config) return { result: [] };

    const db = await getDb(bindings);
    const accounts = await db.select().from(integrations).where(eq(integrations.enabled, true));
    const kind = syncKinds[Math.floor(Date.now() / (10 * 60_000)) % syncKinds.length];
    const backfillDays = Number(readEnv(bindings, "SYNC_BACKFILL_DAYS")) || 180;

    const results: StepResult[] = [];
    for (const account of accounts) {
      try {
        results.push(await runGoogleSyncStep(db, config, account, kind, { backfillDays }));
      } catch (error) {
        // Already recorded on the integration row as lastError.
        console.error(`google:sync ${kind} failed for ${account.accountEmail}`, error);
      }
    }
    return { result: results };
  },
});
