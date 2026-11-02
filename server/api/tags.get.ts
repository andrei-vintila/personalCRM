import { defineHandler } from "nitro/h3";
import { listTags } from "../utils/contacts";
import { useDb } from "../utils/db";

export default defineHandler(async (event) => listTags(await useDb(event)));
