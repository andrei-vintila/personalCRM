import { defineHandler, getSession } from "nitro/h3";
import { sessionConfig } from "../../utils/auth";

export default defineHandler(async (event) => {
  const session = await getSession<{ user?: string }>(event, await sessionConfig(event));
  return { authenticated: Boolean(session.data.user) };
});
