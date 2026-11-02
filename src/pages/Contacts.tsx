import { useDeferredValue } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Copy, Search, Star } from "lucide-react";
import { api, type ContactSummary, type TagCount } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Avatar, Badge, Card, cx, Empty, Input, Select } from "../components/ui";
import { useDuplicates } from "./Duplicates";

const filters = [
  { id: "all", label: "All" },
  { id: "starred", label: "Starred" },
  { id: "reconnect", label: "Reconnect" },
  { id: "archived", label: "Archived" },
] as const;

export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const filter = params.get("filter") ?? "all";
  const tag = params.get("tag") ?? "";
  const deferredQ = useDeferredValue(q);

  const update = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && !(key === "filter" && value === "all")) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const contacts = useQuery({
    queryKey: ["contacts", { q: deferredQ, filter, tag }],
    queryFn: () => api<ContactSummary[]>(`/contacts?${new URLSearchParams({ q: deferredQ, filter, tag })}`),
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<TagCount[]>("/tags") });
  const duplicates = useDuplicates();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>

      {(duplicates.data?.total ?? 0) > 0 && (
        <Link
          to="/contacts/duplicates"
          className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900"
        >
          <Copy className="size-4" />
          {duplicates.data!.total} possible {duplicates.data!.total === 1 ? "duplicate" : "duplicates"}
          <span className="ml-auto font-medium">Review →</span>
        </Link>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" />
          <Input
            className="pl-9"
            placeholder="Search name, company, email, phone…"
            value={q}
            onChange={(e) => update("q", e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => update("filter", f.id)}
                className={cx(
                  "rounded-md px-2.5 py-1 text-sm font-medium",
                  filter === f.id ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {(tags.data?.length ?? 0) > 0 && (
            <Select className="w-36!" value={tag} onChange={(e) => update("tag", e.target.value)}>
              <option value="">All tags</option>
              {tags.data!.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.count})
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <Card>
        {contacts.data?.length === 0 ? (
          <Empty>{q || tag || filter !== "all" ? "No matches." : "No contacts yet. Create one or import from LinkedIn or Google."}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {contacts.data?.map((c) => (
              <li key={c.id}>
                <Link to={`/contacts/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <Avatar name={c.name} src={c.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      {c.starred && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {[c.title, c.company].filter(Boolean).join(" · ") || c.email || c.phone || " "}
                    </div>
                  </div>
                  <div className="hidden gap-1 md:flex">
                    {c.tags.slice(0, 3).map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs text-zinc-500">
                    {c.dueAt && c.dueAt <= Date.now() ? (
                      <Badge tone="warn">reconnect</Badge>
                    ) : c.lastInteractionAt ? (
                      relativeTime(c.lastInteractionAt)
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {contacts.data && contacts.data.length >= 500 && (
        <p className="text-center text-xs text-zinc-500">Showing the first 500. Search to narrow it down.</p>
      )}
    </div>
  );
}
