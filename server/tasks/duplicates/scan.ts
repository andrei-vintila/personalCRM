import { defineTask } from "nitro/task";
import { getDb } from "../../utils/db";
import type { CloudflareBindings } from "../../utils/env";
import { scanIfStale } from "../../utils/duplicateScan";

/** Scheduled duplicate scan; a no-op unless contacts changed since the last scan. */
export default defineTask<string>({
  meta: { name: "duplicates:scan", description: "Recompute duplicate candidates when contacts changed" },
  async run({ context }) {
    const bindings = (context as { cloudflare?: { env?: CloudflareBindings } }).cloudflare?.env;
    return { result: await scanIfStale(await getDb(bindings)) };
  },
});
