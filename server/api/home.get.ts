import { and, asc, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { defineHandler } from "nitro/h3";
import { contacts, interactions, reminders } from "../db/schema";
import { birthdayOccurrences, daysUntilBirthday } from "../utils/birthdays";
import { listContacts, listInteractions, sourceColumns, withSources } from "../utils/contacts";
import { useDb } from "../utils/db";

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 10;

export default defineHandler(async (event) => {
  const db = await useDb(event);
  const now = Date.now();

  const [reconnect, recent, dueReminders, birthdayRows, [stats]] = await Promise.all([
    listContacts(db, { filter: "reconnect", limit: 12 }),
    listInteractions(db, { limit: RECENT_LIMIT }),
    db.query.reminders.findMany({
      where: and(isNull(reminders.completedAt), lte(reminders.dueAt, new Date(now + 7 * DAY_MS))),
      orderBy: [asc(reminders.dueAt)],
      limit: 20,
      with: { contact: { columns: { id: true, name: true, avatarUrl: true } } },
    }),
    db
      .select({ id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl, birthday: contacts.birthday, source: contacts.source, ...sourceColumns })
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
    .map((c) => ({ ...withSources(c), inDays: daysUntilBirthday(c.birthday!, new Date(now)) }))
    .filter((c) => c.inDays !== null && c.inDays <= 30)
    .sort((a, b) => a.inDays! - b.inDays!);

  // Birthdays that passed within the span "recent" covers, so the activity feed shows them in place.
  // Upcoming ones are in `birthdays` already.
  const from = recent.length === RECENT_LIMIT ? recent.at(-1)!.occurredAt : new Date(now - 30 * DAY_MS);
  const today = new Date(now);
  const todayKey = today.toISOString().slice(0, 10);
  const birthdayEvents = birthdayRows
    .flatMap((c) =>
      birthdayOccurrences(c.birthday!, { from, today })
        .filter((o) => o.date <= todayKey)
        .map((o) => ({ ...o, contact: { id: c.id, name: c.name, avatarUrl: c.avatarUrl } })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  return { reconnect, recent, reminders: dueReminders, birthdays, birthdayEvents, stats };
});
