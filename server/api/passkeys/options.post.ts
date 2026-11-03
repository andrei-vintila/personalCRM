import { defineHandler } from "nitro/h3";
import { useDb } from "../../utils/db";
import { registrationOptions } from "../../utils/passkeys";

/** Step 1 of adding a passkey: options for navigator.credentials.create(). */
export default defineHandler(async (event) => registrationOptions(event, await useDb(event)));
