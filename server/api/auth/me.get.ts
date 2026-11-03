import { defineHandler, getSession } from "nitro/h3";
import { sessionConfig, type SessionData } from "../../utils/auth";

export default defineHandler(async (event) => {
  const session = await getSession<SessionData>(event, await sessionConfig(event));
  return { authenticated: Boolean(session.data.user) };
});
