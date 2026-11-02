import { asc, desc, isNotNull, isNull } from "drizzle-orm";
import { defineHandler, getQuery } from "nitro/h3";
import { reminders } from "../../db/schema";
import { useDb } from "../../utils/db";

export default defineHandler(async (event) => {
  const { status } = getQuery<{ status?: string }>(event);
  const done = status === "done";
  const db = await useDb(event);
  return db.query.reminders.findMany({
    where: done ? isNotNull(reminders.completedAt) : isNull(reminders.completedAt),
    orderBy: done ? [desc(reminders.completedAt)] : [asc(reminders.dueAt)],
    limit: 500,
    with: { contact: { columns: { id: true, name: true, avatarUrl: true } } },
  });
});
