import { defineHandler, getSession, HTTPError } from "nitro/h3";
import { sessionConfig } from "../utils/auth";

const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/me", "/api/health"]);

export default defineHandler(async (event) => {
  const { pathname } = event.url;
  if (!pathname.startsWith("/api/") || PUBLIC_API.has(pathname)) return;

  const session = await getSession<{ user?: string }>(event, await sessionConfig(event));
  if (!session.data.user) throw new HTTPError({ status: 401, message: "Not signed in" });
});
