import { defineHandler, redirect, setCookie } from "nitro/h3";
import { authorizationUrl } from "../../../utils/google/client";
import { googleRedirectUri, OAUTH_STATE_COOKIE, requireGoogleConfig } from "../../../utils/google/http";

/** Browser navigation target: starts the Google consent flow. */
export default defineHandler((event) => {
  const config = requireGoogleConfig(event);
  const state = crypto.randomUUID();
  setCookie(event, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: !import.meta.dev,
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return redirect(authorizationUrl(config, googleRedirectUri(event), state));
});
