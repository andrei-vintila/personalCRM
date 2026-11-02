import { defineHandler, getRouterParam } from "nitro/h3";
import { getContactDetail } from "../../utils/contacts";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  return getContactDetail(await useDb(event), getRouterParam(event, "id")!);
});
