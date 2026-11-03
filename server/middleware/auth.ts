import { defineHandler, getSession, HTTPError } from "nitro/h3";
import { bearerToken, verifyApiToken } from "../utils/apiTokens";
import { sessionConfig, type SessionData } from "../utils/auth";
import { useDb } from "../utils/db";

const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/passkey/options", "/api/auth/passkey/login", "/api/auth/me", "/api/health"]);
/** Managing tokens and passkeys needs a signed-in browser session, never a token. */
const SESSION_ONLY = /^\/api\/(tokens|passkeys)(\/|$)/;

export default defineHandler(async (event) => {
  const { pathname } = event.url;
  const isApi = pathname.startsWith("/api/");
  const isMcp = pathname === "/mcp";
  if ((!isApi && !isMcp) || PUBLIC_API.has(pathname)) return;

  const token = bearerToken(event);
  if (token && !SESSION_ONLY.test(pathname)) {
    if (await verifyApiToken(await useDb(event), token)) {
      event.context.auth = "token";
      return;
    }
    throw new HTTPError({ status: 401, message: "Invalid API token" });
  }

  const session = await getSession<SessionData>(event, await sessionConfig(event));
  if (!session.data.user) throw new HTTPError({ status: 401, message: isMcp ? "Use an API token: Authorization: Bearer prm_…" : "Not signed in" });
  event.context.auth = "session";
});
