import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api, type ContactDetail, type ContactSummary } from "../lib/api";
import { formatBirthday } from "../lib/format";
import { Avatar, Badge, Button, cx, Dialog, ErrorText, Input } from "./ui";
import { SourceIcons } from "./SourceIcons";

/** The parts of a contact the merge screen needs (works for list rows and details). */
export interface MergeCandidate {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  location: string | null;
  avatarUrl: string | null;
  birthday: string | null;
  about: string | null;
  createdAt: string;
  tags: string[];
  sources: string[];
  identities: { kind: string; value: string }[];
}

const pickable = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "location", label: "Location" },
  { key: "birthday", label: "Birthday" },
  { key: "avatarUrl", label: "Photo" },
] as const;
type PickKey = (typeof pickable)[number]["key"];

export function MergeDialog({
  open,
  onClose,
  candidates,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  candidates: MergeCandidate[];
  onMerged?: (merged: ContactDetail) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Merge contacts" wide>
      {open && candidates.length >= 2 && <MergeForm candidates={candidates} onDone={onClose} onMerged={onMerged} />}
    </Dialog>
  );
}

function MergeForm({
  candidates,
  onDone,
  onMerged,
}: {
  candidates: MergeCandidate[];
  onDone: () => void;
  onMerged?: (merged: ContactDetail) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Keep the oldest record by default: it usually has the most history attached.
  const [primaryId, setPrimaryId] = useState(
    () => [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id,
  );
  const primary = candidates.find((c) => c.id === primaryId)!;
  const stacked = candidates.length > 2;

  const conflicts = pickable
    .map(({ key, label }) => ({ key, label, values: [...new Set(candidates.map((c) => c[key]).filter((v): v is string => Boolean(v)))] }))
    .filter((f) => f.values.length > 1);
  const [picks, setPicks] = useState<Partial<Record<PickKey, string>>>({});
  const valueFor = (key: PickKey) => picks[key] ?? primary[key] ?? candidates.find((c) => c[key])?.[key] ?? null;

  const merge = useMutation({
    mutationFn: () =>
      api<ContactDetail>(`/contacts/${primaryId}/merge`, {
        method: "POST",
        body: {
          sourceIds: candidates.filter((c) => c.id !== primaryId).map((c) => c.id),
          fields: Object.fromEntries(conflicts.map((f) => [f.key, valueFor(f.key)])),
        },
      }),
    onSuccess: (merged) => {
      for (const c of candidates) queryClient.removeQueries({ queryKey: ["contact", c.id] });
      queryClient.setQueryData(["contact", merged.id], merged);
      queryClient.invalidateQueries();
      onDone();
      if (onMerged) onMerged(merged);
      else navigate(`/contacts/${merged.id}`);
    },
  });

  const identities = [...new Map(candidates.flatMap((c) => c.identities).map((i) => [`${i.kind}:${i.value}`, i])).values()];
  const tags = [...new Set(candidates.flatMap((c) => c.tags))].sort();
  const notes = candidates.filter((c) => c.about?.trim()).length;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">Keep this record</p>
        {/* Two records sit side by side; three or more stack vertically. */}
        <div className={cx("grid gap-2", !stacked && "sm:grid-cols-2")}>
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => setPrimaryId(c.id)}
              className={cx(
                "flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition-colors",
                c.id === primaryId ? "bg-accent-50 ring-2 ring-accent-500 dark:bg-accent-700/20" : "ring-zinc-200 hover:ring-zinc-300 dark:ring-zinc-700",
              )}
            >
              <Avatar name={c.name} src={c.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <SourceIcons sources={c.sources} />
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {[c.title, c.company].filter(Boolean).join(" · ") || c.identities[0]?.value || "No details"}
                </div>
              </div>
              {c.id === primaryId && <Check className="size-4 text-accent-600" />}
            </button>
          ))}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Choose values that differ</p>
          {conflicts.map((f) => (
            <fieldset key={f.key} className="space-y-1">
              <legend className="text-xs text-zinc-500">{f.label}</legend>
              <div className={cx("flex gap-2", stacked ? "flex-col items-start" : "flex-wrap")}>
                {f.values.map((value) => (
                  <label
                    key={value}
                    className={cx(
                      "flex max-w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1",
                      valueFor(f.key) === value ? "bg-accent-50 ring-accent-500 dark:bg-accent-700/20" : "ring-zinc-200 dark:ring-zinc-700",
                    )}
                  >
                    <input
                      type="radio"
                      className="accent-accent-600"
                      name={f.key}
                      checked={valueFor(f.key) === value}
                      onChange={() => setPicks((p) => ({ ...p, [f.key]: value }))}
                    />
                    {f.key === "avatarUrl" ? (
                      <Avatar name={primary.name} src={value} size={24} />
                    ) : (
                      <span className="truncate">{f.key === "birthday" ? formatBirthday(value) : value}</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
        <p className="font-medium">The merged contact keeps everything:</p>
        <div className="flex flex-wrap gap-1">
          {identities.map((i) => (
            <Badge key={`${i.kind}:${i.value}`}>{i.value}</Badge>
          ))}
          {tags.map((t) => (
            <Badge key={t} tone="accent">
              {t}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Timelines, reminders and tags are combined{notes > 1 ? ", and the notes are joined" : ""}. The other{" "}
          {candidates.length > 2 ? "records are" : "record is"} deleted. This can't be undone.
        </p>
      </div>

      <ErrorText error={merge.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={merge.isPending} onClick={() => merge.mutate()}>
          Merge {candidates.length} contacts
        </Button>
      </div>
    </div>
  );
}

/** "Merge with…": search for another contact, then open the merge screen for both. */
export function MergeWithDialog({ open, onClose, contact }: { open: boolean; onClose: () => void; contact: ContactDetail }) {
  const [q, setQ] = useState("");
  const [other, setOther] = useState<ContactDetail>();
  const results = useQuery({
    queryKey: ["contacts", { q, filter: "all", tag: "", mergePicker: true }],
    queryFn: () => api<ContactSummary[]>(`/contacts?${new URLSearchParams({ q })}`),
    enabled: open && q.trim().length > 0,
  });
  const pick = useMutation({
    mutationFn: (id: string) => api<ContactDetail>(`/contacts/${id}`),
    onSuccess: setOther,
  });
  const close = () => {
    setQ("");
    setOther(undefined);
    onClose();
  };

  if (other) return <MergeDialog open={open} onClose={close} candidates={[contact, other]} />;
  return (
    <Dialog open={open} onClose={close} title={`Merge ${contact.name} with…`}>
      <div className="space-y-3">
        <Input autoFocus placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {results.data
            ?.filter((c) => c.id !== contact.id)
            .slice(0, 20)
            .map((c) => (
              <li key={c.id}>
                <button
                  className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  disabled={pick.isPending}
                  onClick={() => pick.mutate(c.id)}
                >
                  <Avatar name={c.name} src={c.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <SourceIcons sources={c.sources} />
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[c.title, c.company].filter(Boolean).join(" · ") || c.email || c.phone}
                    </span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
        <ErrorText error={pick.error ?? results.error} />
      </div>
    </Dialog>
  );
}
