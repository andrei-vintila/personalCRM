import { and, eq } from "drizzle-orm";
import { defineHandler, readValidatedBody } from "nitro/h3";
import { duplicateCandidates, duplicateDismissals } from "../../db/schema";
import { runBatch, useDb } from "../../utils/db";
import { dismissSchema } from "../../utils/validation";

/** "Not the same person": hides the given pairs now and from future scans. */
export default defineHandler(async (event) => {
  const { pairs } = await readValidatedBody(event, dismissSchema);
  const sorted = [...new Map(pairs.map((p) => [...p].sort() as [string, string]).map((p) => [p.join(":"), p])).values()];
  const db = await useDb(event);
  await runBatch(db, [
    db
      .insert(duplicateDismissals)
      .values(sorted.map(([contactA, contactB]) => ({ contactA, contactB })))
      .onConflictDoNothing(),
    ...sorted.map(([contactA, contactB]) =>
      db.delete(duplicateCandidates).where(and(eq(duplicateCandidates.contactA, contactA), eq(duplicateCandidates.contactB, contactB))),
    ),
  ]);
  return { dismissed: sorted.length };
});
