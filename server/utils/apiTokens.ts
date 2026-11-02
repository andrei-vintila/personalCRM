import { eq } from "drizzle-orm";
import { getRequestHeader, type H3Event } from "nitro/h3";
import { apiTokens } from "../db/schema";
import type { DB } from "./db";

const TOKEN_PREFIX = "crm_";
/** Avoid a write on every request: lastUsedAt is only refreshed this often. */
const TOUCH_INTERVAL_MS = 60_000;

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiToken(db: DB, name: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const [row] = await db
    .insert(apiTokens)
    .values({ name, tokenHash: await hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) })
    .returning({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt });
  return { ...row, token };
}

export function bearerToken(event: H3Event) {
  const header = getRequestHeader(event, "authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

/** True when the request carries a valid API token (and records its use). */
export async function verifyApiToken(db: DB, token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, await hashToken(token)));
  if (!row) return false;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  }
  return true;
}
