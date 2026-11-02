import { defineHandler, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { createReminder } from "../../utils/mutations";
import { reminderInputSchema } from "../../utils/validation";

export default defineHandler(async (event) => {
  const input = await readValidatedBody(event, reminderInputSchema);
  const reminder = await createReminder(await useDb(event), input);
  event.res.status = 201;
  return reminder;
});
