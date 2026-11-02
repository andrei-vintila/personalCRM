import { defineHandler, getRouterParam, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { updateContact } from "../../utils/mutations";
import { contactPatchSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const input = await readValidatedBody(event, contactPatchSchema);
  return updateContact(await useDb(event), getRouterParam(event, "id")!, input);
});
