import { defineHandler } from "nitro/h3";
import { useDb } from "../../utils/db";
import { listPasskeys } from "../../utils/passkeys";

export default defineHandler(async (event) => listPasskeys(await useDb(event)));
