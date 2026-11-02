import { defineHandler, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { logInteraction } from "../../utils/mutations";
import { interactionInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const input = await readValidatedBody(event, interactionInputSchema);
  const interaction = await logInteraction(await useDb(event), input);
  event.res.status = 201;
  return interaction;
});
