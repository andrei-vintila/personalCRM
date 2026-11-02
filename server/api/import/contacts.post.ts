import { defineHandler, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { importContacts } from "../../utils/ingest";
import { importBatchSchema } from "../../utils/validation";

/**
 * Find-or-create a batch of contacts from a CSV import. The client sends small
 * batches so a single Worker invocation stays inside D1's per-invocation query limit.
 */
export default defineHandler(async (event) => {
  const { source, tag, contacts } = await readValidatedBody(event, importBatchSchema);
  const { created, updated } = await importContacts(await useDb(event), { source, tag, rows: contacts });
  return { created, updated };
});
