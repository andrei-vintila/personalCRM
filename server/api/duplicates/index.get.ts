import { defineHandler } from "nitro/h3";
import { useDb } from "../../utils/db";
import { contactsFingerprint, getScanJob, listDuplicateGroups } from "../../utils/duplicateScan";

const MAX_GROUPS = 100;

/**
 * Results of the latest duplicate scan, grouped into clusters, plus its status. Nothing is computed here;
 * `scan.stale` tells the client contacts changed since that scan.
 */
export default defineHandler(async (event) => {
  const db = await useDb(event);
  const [job, fingerprint, { total, groups }] = await Promise.all([
    getScanJob(db),
    contactsFingerprint(db),
    listDuplicateGroups(db, MAX_GROUPS),
  ]);
  const found = Number(job?.result?.total ?? 0);
  return {
    total,
    /** More pairs exist than are stored; merge or dismiss some and rescan. */
    capped: found > Number(job?.result?.stored ?? 0),
    groups,
    scan: {
      status: job?.status ?? "idle",
      startedAt: job?.startedAt ?? null,
      finishedAt: job?.finishedAt ?? null,
      error: job?.error ?? null,
      stale: job?.fingerprint !== fingerprint,
    },
  };
});
