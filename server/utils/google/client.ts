import { eq } from "drizzle-orm";
import { integrations, type Integration } from "../../db/schema";
import { decryptSecret, encryptSecret } from "../crypto";
import type { DB } from "../db";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Prefix for every Google URL; only set when pointing at a local mock. */
  apiOrigin?: string;
}

export function googleConfig(env: (key: string) => string | undefined): GoogleConfig | undefined {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret, apiOrigin: env("GOOGLE_API_ORIGIN_OVERRIDE") };
}

/** `https://<host><path>`, or `<override>/<host><path>` when testing against a mock. */
export function googleUrl(config: GoogleConfig, host: string, path: string) {
  return config.apiOrigin ? `${config.apiOrigin}/${host}${path}` : `https://${host}${path}`;
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function authorizationUrl(config: GoogleConfig, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always show consent so Google returns a refresh token on reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${googleUrl(config, "accounts.google.com", "/o/oauth2/v2/auth")}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(config: GoogleConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(googleUrl(config, "oauth2.googleapis.com", "/token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) throw new GoogleApiError(res.status, json.error_description || json.error || `Token request failed (${res.status})`);
  return json;
}

/** Exchanges the OAuth code, then stores (or refreshes) the integration row. */
export async function connectGoogleAccount(db: DB, config: GoogleConfig, code: string, redirectUri: string) {
  const token = await tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!token.refresh_token) throw new GoogleApiError(400, "Google did not return a refresh token. Remove the app's access in your Google account and try again.");

  const missing = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !token.scope.split(" ").includes(s));
  if (missing.length > 0) throw new GoogleApiError(400, "Please grant all requested permissions (contacts, Gmail metadata, calendar).");

  const info = await googleJson<{ email: string }>(config, token.access_token, "openidconnect.googleapis.com", "/v1/userinfo");
  const values = {
    provider: "google" as const,
    accountEmail: info.email.toLowerCase(),
    accessToken: await encryptSecret(token.access_token, config.clientSecret),
    refreshToken: await encryptSecret(token.refresh_token, config.clientSecret),
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scopes: token.scope,
  };
  const [row] = await db
    .insert(integrations)
    .values(values)
    .onConflictDoUpdate({
      target: [integrations.provider, integrations.accountEmail],
      set: { ...values, enabled: true, lastError: null },
    })
    .returning();
  return row;
}

/** Returns a valid access token, refreshing (and persisting) it when close to expiry. */
export async function accessTokenFor(db: DB, config: GoogleConfig, integration: Integration, force = false) {
  if (!force && integration.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(integration.accessToken, config.clientSecret);
  }
  const refreshToken = await decryptSecret(integration.refreshToken, config.clientSecret);
  const token = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const accessToken = await encryptSecret(token.access_token, config.clientSecret);
  await db.update(integrations).set({ accessToken, expiresAt }).where(eq(integrations.id, integration.id));
  integration.accessToken = accessToken;
  integration.expiresAt = expiresAt;
  return token.access_token;
}

export async function googleJson<T>(
  config: GoogleConfig,
  accessToken: string,
  host: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined) query.set(key, String(value));
  const url = googleUrl(config, host, path) + (query.size ? `?${query}` : "");
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GoogleApiError(res.status, body?.error?.message ?? `${host} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Gmail batch endpoint: many GETs in one HTTP request (one Worker subrequest).
 * Returns parsed JSON bodies in request order; failed items are null.
 */
export async function gmailBatchGet<T>(config: GoogleConfig, accessToken: string, paths: string[]): Promise<(T | null)[]> {
  if (paths.length === 0) return [];
  const boundary = `batch_${crypto.randomUUID()}`;
  const body =
    paths
      .map((path, i) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item${i}>\r\n\r\nGET ${path}\r\n`)
      .join("\r\n") + `\r\n--${boundary}--`;

  const res = await fetch(googleUrl(config, "gmail.googleapis.com", "/batch/gmail/v1"), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/mixed; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new GoogleApiError(res.status, `Gmail batch request failed (${res.status})`);

  const responseBoundary = res.headers.get("content-type")?.match(/boundary=("?)([^";]+)\1/)?.[2];
  if (!responseBoundary) throw new GoogleApiError(502, "Gmail batch response had no boundary");
  const results: (T | null)[] = paths.map(() => null);

  for (const part of (await res.text()).split(`--${responseBoundary}`)) {
    const index = Number(part.match(/Content-ID:\s*<response-item(\d+)>/i)?.[1]);
    const status = Number(part.match(/HTTP\/[\d.]+ (\d{3})/)?.[1]);
    if (Number.isNaN(index) || status === 401) {
      if (status === 401) throw new GoogleApiError(401, "Access token expired");
      continue;
    }
    if (status !== 200) continue;
    const json = part.slice(part.indexOf("{"), part.lastIndexOf("}") + 1);
    try {
      results[index] = JSON.parse(json) as T;
    } catch {
      // leave null
    }
  }
  return results;
}
