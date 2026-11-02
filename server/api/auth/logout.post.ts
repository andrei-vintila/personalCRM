import { clearSession, defineHandler } from "nitro/h3";
import { sessionConfig } from "../../utils/auth";

export default defineHandler(async (event) => {
  await clearSession(event, await sessionConfig(event));
  return { authenticated: false };
});
