import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { defineHandler, readValidatedBody } from "nitro/h3";
import { z } from "zod";
import { useDb } from "../../utils/db";
import { registerPasskey } from "../../utils/passkeys";

/** Step 2 of adding a passkey: verifies the authenticator's response and stores it. */
export default defineHandler(async (event) => {
  const { name, response } = await readValidatedBody(
    event,
    z.object({ name: z.string().trim().min(1).max(80), response: z.looseObject({ id: z.string().min(1) }) }),
  );
  event.res.status = 201;
  return registerPasskey(event, await useDb(event), name, response as unknown as RegistrationResponseJSON);
});
