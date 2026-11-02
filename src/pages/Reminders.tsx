import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { api, type ReminderItem } from "../lib/api";
import { formatDate, relativeTime } from "../lib/format";
import { Avatar, Badge, Button, Card, cx, Empty } from "../components/ui";

export function RemindersPage() {
  const [status, setStatus] = useState<"open" | "done">("open");
  const reminders = useQuery({
    queryKey: ["reminders", status],
    queryFn: () => api<ReminderItem[]>(`/reminders?status=${status}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
          {(["open", "done"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cx(
                "rounded-md px-2.5 py-1 text-sm font-medium capitalize",
                status === s ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <Card>
        {reminders.data?.length === 0 ? (
          <Empty>{status === "open" ? "Nothing to do. Add reminders from a contact's page." : "No completed reminders yet."}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {reminders.data?.map((r) => (
              <ReminderRow key={r.id} reminder={r} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ReminderRow({ reminder }: { reminder: ReminderItem }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["reminders"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["contact"] });
  };
  const toggle = useMutation({
    mutationFn: () => api(`/reminders/${reminder.id}`, { method: "PATCH", body: { completed: !reminder.completedAt } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/reminders/${reminder.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const overdue = !reminder.completedAt && new Date(reminder.dueAt).getTime() < Date.now();

  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <button
        onClick={() => toggle.mutate()}
        aria-label={reminder.completedAt ? "Mark as open" : "Mark as done"}
        className={cx(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full ring-1 transition-colors",
          reminder.completedAt
            ? "bg-accent-600 text-white ring-accent-600"
            : "text-transparent ring-zinc-300 hover:text-zinc-400 dark:ring-zinc-700",
        )}
      >
        <Check className="size-3" />
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("truncate text-sm", reminder.completedAt && "text-zinc-400 line-through")}>{reminder.note}</div>
        {reminder.contact && (
          <Link to={`/contacts/${reminder.contact.id}`} className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:underline">
            <Avatar name={reminder.contact.name} src={reminder.contact.avatarUrl} size={16} />
            {reminder.contact.name}
          </Link>
        )}
      </div>
      <span title={formatDate(reminder.dueAt, true)} className="text-xs text-zinc-500">
        {overdue ? <Badge tone="warn">{relativeTime(reminder.dueAt)}</Badge> : relativeTime(reminder.dueAt)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Delete"
        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={() => remove.mutate()}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
