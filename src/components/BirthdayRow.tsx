import { Link } from "react-router";
import { Cake } from "lucide-react";
import type { InteractionItem } from "../lib/api";

const DAY_MS = 86_400_000;

export interface BirthdayEvent {
  /** YYYY-MM-DD */
  date: string;
  age: number | null;
  contact?: { id: string; name: string };
}

export type TimelineEntry = { kind: "interaction"; at: number; interaction: InteractionItem } | { kind: "birthday"; at: number; birthday: BirthdayEvent };

/** A birthday as a local calendar day (birthdays aren't instants, so no time zone shift). */
function localDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Interactions and birthdays in one list, newest first; upcoming birthdays sit on top. */
export function mergeTimeline(interactions: InteractionItem[], birthdays: BirthdayEvent[]): TimelineEntry[] {
  return [
    ...interactions.map((interaction) => ({ kind: "interaction" as const, at: new Date(interaction.occurredAt).getTime(), interaction })),
    // End of the day, so a birthday sits above that day's interactions.
    ...birthdays.map((birthday) => ({ kind: "birthday" as const, at: localDay(birthday.date).getTime() + DAY_MS - 1, birthday })),
  ].sort((a, b) => b.at - a.at);
}

function daysFromToday(date: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((localDay(date).getTime() - today.getTime()) / DAY_MS);
}

export function BirthdayRow({ birthday, showContact }: { birthday: BirthdayEvent; showContact?: boolean }) {
  const days = daysFromToday(birthday.date);
  const upcoming = days > 0;
  const name = showContact && birthday.contact ? birthday.contact.name : null;
  const verb = days >= 0 ? (name ? "turns" : "Turns") : name ? "turned" : "Turned";
  const title = birthday.age
    ? `${name ? `${name} ` : ""}${verb} ${birthday.age}${days === 0 ? " today" : ""}`
    : name
      ? `${name}'s birthday${days === 0 ? " is today" : ""}`
      : days === 0
        ? "Birthday today"
        : "Birthday";
  const when =
    Math.abs(days) < 30 && days !== 0
      ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day")
      : localDay(birthday.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <li className={`flex gap-3 px-4 py-3 ${upcoming ? "bg-accent-50/60 dark:bg-accent-700/10" : ""}`}>
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100">
        <Cake className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-sm">
        {name ? (
          <Link to={`/contacts/${birthday.contact!.id}`} className="font-medium hover:underline">
            {title}
          </Link>
        ) : (
          <span className="font-medium">{title}</span>
        )}
        <span className="text-xs text-zinc-500" title={localDay(birthday.date).toLocaleDateString(undefined, { dateStyle: "full" })}>
          {days === 0 ? "today" : when}
          {upcoming && " · upcoming"}
        </span>
      </div>
    </li>
  );
}
