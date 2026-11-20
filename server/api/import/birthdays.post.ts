import { defineHandler, readValidatedBody } from "nitro/h3";
import { parseBirthday } from "../../utils/birthdays";
import { useDb } from "../../utils/db";
import { fillBirthdays } from "../../utils/ingest";
import { importBirthdaysSchema } from "../../utils/validation";

/**
 * Adds birthdays from an address book (the Mac app's Apple Contacts sync) to people
 * already in the PRM, matched by email or phone. Unknown people are not created and
 * birthdays you already have are kept.
 */
export default defineHandler(async (event) => {
  const { items } = await readValidatedBody(event, importBirthdaysSchema);
  return fillBirthdays(
    await useDb(event),
    items.filter((i) => parseBirthday(i.birthday)),
  );
});
