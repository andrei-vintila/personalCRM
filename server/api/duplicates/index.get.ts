import { asc } from "drizzle-orm";
import { defineHandler } from "nitro/h3";
import { contacts, duplicateDismissals } from "../../db/schema";
import { useDb } from "../../utils/db";
import { findDuplicatePairs, pairKey } from "../../utils/duplicates";

const MAX_PAIRS = 200;

/** Likely duplicate pairs, best first, with enough of each contact to compare side by side. */
export default defineHandler(async (event) => {
  const db = await useDb(event);
  const [rows, dismissals] = await Promise.all([
    db.query.contacts.findMany({
      orderBy: [asc(contacts.createdAt)],
      with: { identities: { columns: { kind: true, value: true } }, tags: { with: { tag: { columns: { name: true } } } } },
    }),
    db.select().from(duplicateDismissals),
  ]);

  const pairs = findDuplicatePairs(
    rows,
    new Set(dismissals.map((d) => pairKey(d.contactA, d.contactB))),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    total: pairs.length,
    pairs: pairs.slice(0, MAX_PAIRS).map((p) => ({
      ...p,
      contacts: p.ids.map((id) => {
        const { tags, ...c } = byId.get(id)!;
        return { ...c, tags: tags.map((t) => t.tag.name) };
      }),
    })),
  };
});
