import { defineHandler, HTTPError, readValidatedBody, updateSession } from "nitro/h3";
import { sessionConfig, verifyPassword } from "../../utils/auth";
import { loginSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const { password } = await readValidatedBody(event, loginSchema);
  const config = await sessionConfig(event);
  if (!(await verifyPassword(event, password))) {
    throw new HTTPError({ status: 401, message: "Wrong password" });
  }
  await updateSession(event, config, { user: "owner" });
  return { authenticated: true };
});
