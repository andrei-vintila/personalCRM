import { defineHandler, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { createContact } from "../../utils/mutations";
import { contactInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const input = await readValidatedBody(event, contactInputSchema);
  const contact = await createContact(await useDb(event), input);
  event.res.status = 201;
  return contact;
});
