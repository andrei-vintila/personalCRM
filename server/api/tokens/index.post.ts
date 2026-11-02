import { defineHandler, readValidatedBody } from "nitro/h3";
import { z } from "zod";
import { createApiToken } from "../../utils/apiTokens";
import { useDb } from "../../utils/db";

/** Creates a token; the plaintext is returned only in this response. */
export default defineHandler(async (event) => {
  const { name } = await readValidatedBody(event, z.object({ name: z.string().trim().min(1).max(80) }));
  event.res.status = 201;
  return createApiToken(await useDb(event), name);
});
