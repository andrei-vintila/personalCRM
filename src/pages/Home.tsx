import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, Cake, History, RefreshCcw } from "lucide-react";
import { api, type HomeData } from "../lib/api";
import { formatBirthday, relativeTime } from "../lib/format";
import { Avatar, Badge, Card, CardHeader, Empty } from "../components/ui";
import { ReminderRow } from "./Reminders";
import { InteractionRow } from "./ContactDetail";
import { SourceIcons } from "../components/SourceIcons";

export function HomePage() {
  const { data } = useQuery({ queryKey: ["home"], queryFn: () => api<HomeData>("/home") });
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data.stats.contacts} {data.stats.contacts === 1 ? "person" : "people"} · {data.stats.tracked ?? 0} with a keep-in-touch goal · {data.stats.interactionsLast30}{" "}
          interactions in the last 30 days
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Time to reconnect"
            icon={<RefreshCcw className="size-4 text-accent-600" />}
            action={
              <Link to="/contacts?filter=reconnect" className="text-xs font-medium text-accent-600 hover:underline">
                See all
              </Link>
            }
          />
          {data.reconnect.length === 0 ? (
            <Empty>You're all caught up. Set a keep-in-touch goal on a contact to see them here.</Empty>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.reconnect.map((c) => (
                <li key={c.id}>
                  <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <Avatar name={c.name} src={c.avatarUrl} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        <SourceIcons sources={c.sources} />
                      </div>
                      <div className="truncate text-xs text-zinc-500">Last talked {relativeTime(c.lastInteractionAt)}</div>
                    </div>
                    <Badge tone="warn">due {relativeTime(c.dueAt)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Reminders this week" icon={<Bell className="size-4 text-accent-600" />} />
            {data.reminders.length === 0 ? (
              <Empty>No reminders due.</Empty>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.reminders.map((r) => (
                  <ReminderRow key={r.id} reminder={r} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Upcoming birthdays" icon={<Cake className="size-4 text-accent-600" />} />
            {data.birthdays.length === 0 ? (
              <Empty>No birthdays in the next 30 days.</Empty>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.birthdays.map((b) => (
                  <li key={b.id}>
                    <Link to={`/contacts/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <Avatar name={b.name} src={b.avatarUrl} size={28} />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{b.name}</span>
                        <SourceIcons sources={b.sources} />
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatBirthday(b.birthday)} · {b.inDays === 0 ? "today" : `in ${b.inDays}d`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Recent activity" icon={<History className="size-4 text-accent-600" />} />
        {data.recent.length === 0 ? (
          <Empty>Log a note, call or meeting on a contact to build your timeline.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.recent.map((i) => (
              <InteractionRow key={i.id} interaction={i} showContacts />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
