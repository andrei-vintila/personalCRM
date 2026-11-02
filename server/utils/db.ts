import type { D1Database } from "@cloudflare/workers-types";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { H3Event } from "nitro/h3";
import * as schema from "../db/schema";
import { cloudflareEnv, type CloudflareBindings } from "./env";

/** Common async SQLite surface shared by D1 and libsql. */
export type DB = BaseSQLiteDatabase<"async", unknown, typeof schema>;

let nodeDb: Promise<DB> | undefined;

/**
 * Cloudflare: uses the `DB` D1 binding (migrations via `wrangler d1 migrations apply`).
 * Node / VM: uses libsql with DATABASE_URL (default `file:./data/crm.db`, Turso URLs work too)
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
  const url = process.env.DATABASE_URL ?? "file:./data/crm.db";

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
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
