import type { D1Database } from "@cloudflare/workers-types";
import { getTableColumns } from "drizzle-orm";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { H3Event } from "nitro/h3";
import * as schema from "../db/schema";
import { cloudflareEnv, type CloudflareBindings } from "./env";

/** Common async SQLite surface shared by D1 and libsql. */
export type DB = BaseSQLiteDatabase<"async", unknown, typeof schema>;

let nodeDb: Promise<DB> | undefined;

/**
 * Cloudflare: uses the `DB` D1 binding (migrations via `wrangler d1 migrations apply`).
 * Node / VM: uses libsql with DATABASE_URL (default `file:./data/prm.db`, Turso URLs work too)
 * and applies pending migrations from MIGRATIONS_DIR on first use.
 */
export function useDb(event: H3Event): Promise<DB> {
  return getDb(cloudflareEnv(event));
}

/** Same as useDb, for code without a request (scheduled tasks). */
export function getDb(bindings: CloudflareBindings): Promise<DB> {
  const d1 = bindings?.DB as D1Database | undefined;
  if (d1) return Promise.resolve(drizzleD1(d1, { schema }) as unknown as DB);
  nodeDb ??= createNodeDb().catch((error) => {
    nodeDb = undefined;
    throw error;
  });
  return nodeDb;
}

async function createNodeDb(): Promise<DB> {
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const url = process.env.DATABASE_URL ?? "file:./data/prm.db";

  if (url.startsWith("file:")) {
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(url.slice("file:".length)), { recursive: true });
  }

  const db = drizzle({ connection: { url, authToken: process.env.DATABASE_AUTH_TOKEN }, schema });
  await db.run("PRAGMA foreign_keys = ON");
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? "./drizzle" });
  return db as unknown as DB;
}

/** D1 caps bound parameters at 100 per statement; keep bulk operations under it. */
export const D1_MAX_PARAMS = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Splits rows for multi-row inserts into `table`. A row binds at most one parameter
 * per column, so sizing by column count stays under D1's limit as the schema grows.
 */
export function insertChunks<T>(table: SQLiteTable, rows: T[]): T[][] {
  const columns = Object.keys(getTableColumns(table)).length;
  return chunk(rows, Math.max(1, Math.floor(D1_MAX_PARAMS / columns)));
}

/**
 * Runs statements atomically: D1 and libsql both execute `batch` as one transaction.
 * Pass unawaited Drizzle query builders; avoid db.run(sql`...`) with parameters,
 * which Drizzle's D1 batch fails to bind.
 */
export async function runBatch(db: DB, queries: PromiseLike<unknown>[]) {
  if (queries.length === 0) return;
  const batch = (db as unknown as { batch?: (q: PromiseLike<unknown>[]) => Promise<unknown> }).batch;
  if (typeof batch !== "function") throw new Error("This database driver does not support batch()");
  await batch.call(db, queries);
}
