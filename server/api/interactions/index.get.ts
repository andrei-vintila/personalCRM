import { defineHandler, getQuery } from "nitro/h3";
import { listInteractions } from "../../utils/contacts";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const { contactId, limit } = getQuery<{ contactId?: string; limit?: string }>(event);
  return listInteractions(await useDb(event), { contactId, limit: Math.min(Number(limit) || 50, 200) });
});
