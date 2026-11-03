import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { contacts, duplicateCandidates, duplicateDismissals, jobs } from "../db/schema";
import { sourceColumns, withSources } from "./contacts";
import { chunk, insertChunks, runBatch, type DB } from "./db";
import { findDuplicatePairs, pairKey } from "./duplicates";

/**
 * Duplicate detection runs as a background job (cron, or on request from the UI)
 * and stores its results in duplicate_candidates; reads never compute anything.
 */

const JOB = "duplicates";
/** A "running" claim older than this is assumed dead (crashed process, killed Worker). */
const STALE_LOCK_MS = 10 * 60_000;
/** Only the best pairs are stored; keeps the write within D1's per-invocation query limit. */
const MAX_STORED = 500;

export type ScanJob = typeof jobs.$inferSelect;

/** Cheap summary of everything detection depends on; changes whenever a scan could give a different answer. */
export async function contactsFingerprint(db: DB): Promise<string> {
  const [row] = await db
    .select({
      contacts: sql<number>`count(*)`,
      updated: sql<number>`max(${contacts.updatedAt})`,
      identities: sql<number>`(select count(*) from contact_identities)`,
      identitiesAdded: sql<number>`(select max(created_at) from contact_identities)`,
    })
    .from(contacts);
  // Dismissals aren't included: dismissing deletes the stored pair directly.
  return [row.contacts, row.updated, row.identities, row.identitiesAdded].join(":");
}

export async function getScanJob(db: DB): Promise<ScanJob | undefined> {
  const [job] = await db.select().from(jobs).where(eq(jobs.name, JOB));
  return job;
}

/** Atomically marks the scan as running. False if another scan holds a fresh claim. */
export async function claimScan(db: DB): Promise<boolean> {
  const now = Date.now();
  await db.insert(jobs).values({ name: JOB }).onConflictDoNothing();
  const claimed = await db
    .update(jobs)
    .set({ status: "running", startedAt: new Date(now), error: null })
    .where(and(eq(jobs.name, JOB), or(ne(jobs.status, "running"), lt(jobs.startedAt, new Date(now - STALE_LOCK_MS)))))
    .returning({ name: jobs.name });
  return claimed.length > 0;
}

/** Runs a claimed scan to completion, recording success or failure on the job row. */
export async function runDuplicateScan(db: DB) {
  const started = Date.now();
  try {
    // Fingerprint first: edits made while scanning will mark the result stale.
    const fingerprint = await contactsFingerprint(db);
    const [rows, dismissals] = await Promise.all([
      db.query.contacts.findMany({
        columns: { id: true, name: true, company: true },
        with: { identities: { columns: { kind: true, value: true } } },
      }),
      db.select().from(duplicateDismissals),
    ]);
    const pairs = findDuplicatePairs(rows, new Set(dismissals.map((d) => pairKey(d.contactA, d.contactB))));
    const stored = pairs.slice(0, MAX_STORED);

    // Replace results and finish the job in one transaction.
    await runBatch(db, [
      db.delete(duplicateCandidates),
      ...insertChunks(duplicateCandidates, stored).map((batch) =>
        db.insert(duplicateCandidates).values(
          batch.map((p) => {
            const [contactA, contactB] = [...p.ids].sort();
            return { contactA, contactB, score: p.score, confidence: p.confidence, reasons: p.reasons };
          }),
        ),
      ),
      db
        .update(jobs)
        .set({
          status: "idle",
          finishedAt: new Date(),
          fingerprint,
          result: { contacts: rows.length, total: pairs.length, stored: stored.length, ms: Date.now() - started },
        })
        .where(eq(jobs.name, JOB)),
    ]);
  } catch (error) {
    await db
      .update(jobs)
      .set({ status: "failed", finishedAt: new Date(), error: error instanceof Error ? error.message : String(error) })
      .where(eq(jobs.name, JOB));
    throw error;
  }
}

/** For cron: scan only when contacts changed since the last successful scan. */
export async function scanIfStale(db: DB): Promise<"skipped" | "busy" | "scanned"> {
  const [job, fingerprint] = await Promise.all([getScanJob(db), contactsFingerprint(db)]);
  if (job?.status === "idle" && job.fingerprint === fingerprint) return "skipped";
  if (!(await claimScan(db))) return "busy";
  await runDuplicateScan(db);
  return "scanned";
}

/**
 * Stored candidates grouped into clusters: if A~B and B~C, A, B and C are reviewed
 * together. Groups are ordered by their strongest match.
 */
export async function listDuplicateGroups(db: DB, limit: number) {
  const candidates = await db.select().from(duplicateCandidates).orderBy(desc(duplicateCandidates.score));

  // Union-find over candidate pairs.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const c of candidates) {
    for (const id of [c.contactA, c.contactB]) if (!parent.has(id)) parent.set(id, id);
    const [a, b] = [find(c.contactA), find(c.contactB)];
    if (a !== b) parent.set(b, a);
  }
  const clusters = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const root = find(c.contactA);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(c);
  }

  const groups = [...clusters.values()]
    // Candidates are score-sorted, so each cluster's first pair is its strongest.
    .sort((x, y) => y[0].score - x[0].score);
  const top = groups.slice(0, limit);

  const ids = [...new Set(top.flatMap((g) => g.flatMap((c) => [c.contactA, c.contactB])))];
  const people = new Map<string, Awaited<ReturnType<typeof loadPeople>>[number]>();
  for (const batch of chunk(ids, 90)) for (const p of await loadPeople(db, batch)) people.set(p.id, p);

  return {
    total: groups.length,
    groups: top.flatMap((pairs) => {
      const members = [...new Set(pairs.flatMap((c) => [c.contactA, c.contactB]))].map((id) => people.get(id));
      if (members.some((m) => !m)) return []; // a contact was deleted since the scan
      return [
        {
          score: pairs[0].score,
          confidence: pairs[0].confidence,
          // Oldest first: it's the default record to keep when merging.
          contacts: members.map((m) => m!).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
          pairs: pairs.map((c) => ({ ids: [c.contactA, c.contactB] as [string, string], score: c.score, reasons: c.reasons })),
        },
      ];
    }),
  };
}

async function loadPeople(db: DB, ids: string[]) {
  const rows = await db.query.contacts.findMany({
    where: inArray(contacts.id, ids),
    extras: sourceColumns,
    with: { identities: { columns: { kind: true, value: true } }, tags: { with: { tag: { columns: { name: true } } } } },
  });
  return rows.map(({ tags, ...c }) => ({ ...withSources(c), tags: tags.map((t) => t.tag.name) }));
}
