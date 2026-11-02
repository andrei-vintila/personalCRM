import { getRequestURL, HTTPError, type H3Event } from "nitro/h3";
import { getEnv } from "../env";
import { googleConfig } from "./client";

export const OAUTH_STATE_COOKIE = "prm_google_oauth";

export function requireGoogleConfig(event: H3Event) {
  const config = googleConfig((key) => getEnv(event, key));
  if (!config) throw new HTTPError({ status: 503, message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured" });
  return config;
}

/** OAuth redirect URI; APP_URL wins when set (useful behind proxies). */
export function googleRedirectUri(event: H3Event) {
  const origin = getEnv(event, "APP_URL")?.replace(/\/+$/, "") ?? getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
  return `${origin}/api/integrations/google/callback`;
}

export function backfillDays(event: H3Event) {
  return Number(getEnv(event, "SYNC_BACKFILL_DAYS")) || 180;
}
