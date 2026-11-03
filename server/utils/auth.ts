import { HTTPError, type H3Event, type SessionConfig } from "nitro/h3";
import { getEnv } from "./env";

export interface SessionData {
  user?: string;
  /** Pending WebAuthn challenge (see passkeys.ts) */
  challenge?: string;
  challengeExpires?: number;
}

/**
 * Single-user auth: one APP_PASSWORD, sealed session cookie. The cookie secret is
 * derived from the password (or SESSION_SECRET if set), so changing the password
 * signs everyone out. Passkeys (passkeys.ts) are an alternative way into the same session.
 */
export async function sessionConfig(event: H3Event): Promise<SessionConfig> {
  const password = getEnv(event, "APP_PASSWORD");
  if (!password) {
    throw new HTTPError({ status: 503, message: "APP_PASSWORD is not configured on the server" });
  }
  const secret = getEnv(event, "SESSION_SECRET") ?? (await sha256Hex(`prm-session:${password}`));
  return {
    name: "prm_session",
    password: secret,
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, sameSite: "lax", secure: !import.meta.dev, path: "/" },
  };
}

export async function verifyPassword(event: H3Event, candidate: string): Promise<boolean> {
  const expected = getEnv(event, "APP_PASSWORD");
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
