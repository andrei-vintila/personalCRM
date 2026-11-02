import { defineHandler, deleteCookie, getCookie, getQuery, redirect } from "nitro/h3";
import { useDb } from "../../../utils/db";
import { connectGoogleAccount } from "../../../utils/google/client";
import { googleRedirectUri, OAUTH_STATE_COOKIE, requireGoogleConfig } from "../../../utils/google/http";

export default defineHandler(async (event) => {
  const { code, state, error } = getQuery<{ code?: string; state?: string; error?: string }>(event);
  const expectedState = getCookie(event, OAUTH_STATE_COOKIE);
  deleteCookie(event, OAUTH_STATE_COOKIE, { path: "/api/integrations/google" });

  const back = (params: Record<string, string>) => redirect(`/settings?${new URLSearchParams(params)}`);
  if (error) return back({ error: error === "access_denied" ? "Google access was not granted." : error });
  if (!code || !state || state !== expectedState) return back({ error: "The sign-in link expired. Please try connecting again." });

  try {
    const account = await connectGoogleAccount(await useDb(event), requireGoogleConfig(event), code, googleRedirectUri(event));
    return back({ connected: account.id });
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : "Could not connect Google" });
  }
});
