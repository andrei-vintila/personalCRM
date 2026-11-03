import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { defineHandler, readValidatedBody, updateSession } from "nitro/h3";
import { z } from "zod";
import { sessionConfig, type SessionData } from "../../../utils/auth";
import { useDb } from "../../../utils/db";
import { verifyPasskeyLogin } from "../../../utils/passkeys";

export default defineHandler(async (event) => {
  const response = (await readValidatedBody(event, z.looseObject({ id: z.string().min(1) }))) as unknown as AuthenticationResponseJSON;
  await verifyPasskeyLogin(event, await useDb(event), response);
  await updateSession<SessionData>(event, await sessionConfig(event), { user: "owner" });
  return { authenticated: true };
});
