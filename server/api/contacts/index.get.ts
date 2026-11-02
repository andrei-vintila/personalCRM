import { defineHandler, getQuery } from "nitro/h3";
import { listContacts, type ContactFilter } from "../../utils/contacts";
import { useDb } from "../../utils/db";

const FILTERS = new Set<ContactFilter>(["all", "starred", "reconnect", "archived"]);

export default defineHandler(async (event) => {
  const query = getQuery<{ q?: string; tag?: string; filter?: string }>(event);
  const filter = FILTERS.has(query.filter as ContactFilter) ? (query.filter as ContactFilter) : "all";
  return listContacts(await useDb(event), { q: query.q, tag: query.tag, filter });
});
