import { and, asc, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { defineHandler } from "nitro/h3";
import { contacts, interactions, reminders } from "../db/schema";
import { listContacts, listInteractions } from "../utils/contacts";
import { useDb } from "../utils/db";

const DAY_MS = 86_400_000;

export default defineHandler(async (event) => {
  const db = await useDb(event);
  const now = Date.now();

  const [reconnect, recent, dueReminders, birthdayRows, [stats]] = await Promise.all([
    listContacts(db, { filter: "reconnect", limit: 12 }),
    listInteractions(db, { limit: 10 }),
    db.query.reminders.findMany({
      where: and(isNull(reminders.completedAt), lte(reminders.dueAt, new Date(now + 7 * DAY_MS))),
      orderBy: [asc(reminders.dueAt)],
      limit: 20,
      with: { contact: { columns: { id: true, name: true, avatarUrl: true } } },
    }),
    db
      .select({ id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl, birthday: contacts.birthday })
      .from(contacts)
      .where(and(isNotNull(contacts.birthday), eq(contacts.archived, false))),
    db
      .select({
        contacts: count(),
        tracked: sql<number>`sum(case when ${contacts.keepInTouchDays} is not null then 1 else 0 end)`,
        interactionsLast30: sql<number>`(select count(*) from ${interactions} where ${interactions.occurredAt} >= ${now - 30 * DAY_MS})`,
      })
      .from(contacts)
      .where(eq(contacts.archived, false)),
  ]);

  const birthdays = birthdayRows
    .map((c) => ({ ...c, inDays: daysUntilBirthday(c.birthday!, new Date(now)) }))
    .filter((c) => c.inDays !== null && c.inDays <= 30)
    .sort((a, b) => a.inDays! - b.inDays!);

  return { reconnect, recent, reminders: dueReminders, birthdays, stats };
});

function daysUntilBirthday(birthday: string, today: Date): number | null {
  const match = birthday.match(/-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [month, day] = [Number(match[1]) - 1, Number(match[2])];
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let next = Date.UTC(today.getUTCFullYear(), month, day);
  if (next < start) next = Date.UTC(today.getUTCFullYear() + 1, month, day);
  return Math.round((next - start) / DAY_MS);
}
