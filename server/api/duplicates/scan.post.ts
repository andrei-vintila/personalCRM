import { defineHandler } from "nitro/h3";
import { useDb } from "../../utils/db";
import { claimScan, runDuplicateScan } from "../../utils/duplicateScan";

/**
 * Starts a duplicate scan in the background and returns 202 right away.
 * If one is already running, this just reports it; poll GET /api/duplicates for the outcome.
 */
export default defineHandler(async (event) => {
  const db = await useDb(event);
  const started = await claimScan(db);
  if (started) {
    // waitUntil keeps the Worker / Node process alive until the scan finishes.
    event.waitUntil(
      runDuplicateScan(db).catch((error) => {
        console.error("Duplicate scan failed", error);
      }),
    );
  }
  event.res.status = 202;
  return { status: "running", started };
});
