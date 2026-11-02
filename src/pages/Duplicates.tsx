import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Avatar, Button, Card, Empty, ErrorText, InfoTip } from "../components/ui";
import { MergeDialog, type MergeCandidate } from "../components/MergeDialog";
import { SourceIcons } from "../components/SourceIcons";

/** A cluster of contacts that look like the same person (2 or more). */
export interface DuplicateGroup {
  score: number;
  confidence: "high" | "medium" | "low";
  contacts: MergeCandidate[];
  pairs: { ids: [string, string]; score: number; reasons: string[] }[];
}

export interface DuplicatesResponse {
  /** Number of groups */
  total: number;
  capped: boolean;
  groups: DuplicateGroup[];
  scan: {
    status: "idle" | "running" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    stale: boolean;
  };
}

/** Stored scan results; polls while a background scan is running. */
export function useDuplicates() {
  return useQuery({
    queryKey: ["duplicates"],
    queryFn: () => api<DuplicatesResponse>("/duplicates"),
    refetchInterval: (query) => (query.state.data?.scan.status === "running" ? 1500 : false),
  });
}

export function DuplicatesPage() {
  const queryClient = useQueryClient();
  const duplicates = useDuplicates();
  const [merging, setMerging] = useState<MergeCandidate[]>();
  const scan = duplicates.data?.scan;

  const startScan = useMutation({
    mutationFn: () => api("/duplicates/scan", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
  });

  // Opening the page requests a scan when there's none yet or contacts changed since the last one.
  const autoRequested = useRef(false);
  useEffect(() => {
    if (!scan || autoRequested.current || scan.status === "running") return;
    if (scan.stale || !scan.finishedAt) {
      autoRequested.current = true;
      startScan.mutate();
    }
  }, [scan, startScan]);

  const running = scan?.status === "running" || startScan.isPending;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <ArrowLeft className="size-3.5" /> Contacts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Possible duplicates</h1>
          <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
            {running
              ? "Scanning…"
              : scan?.finishedAt
                ? `Scanned ${relativeTime(scan.finishedAt)}${scan.stale ? " · contacts changed since" : ""}`
                : "Not scanned yet"}
            <Button size="sm" disabled={running} onClick={() => startScan.mutate()}>
              <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} />
              Scan now
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Found by similar names, nicknames, phone numbers in different formats and matching email usernames. Scans run in the
          background every 30 minutes when contacts change.
        </p>
      </div>

      <ErrorText error={duplicates.error ?? startScan.error} />
      {scan?.status === "failed" && scan.error && <ErrorText error={`Last scan failed: ${scan.error}`} />}
      {duplicates.data?.groups.length === 0 && !running && (
        <Card>
          <Empty>{scan?.finishedAt ? "No duplicates found." : "Waiting for the first scan."}</Empty>
        </Card>
      )}
      <div className="space-y-3">
        {duplicates.data?.groups.map((group) => (
          <GroupCard key={group.contacts.map((c) => c.id).join(":")} group={group} onMerge={setMerging} />
        ))}
      </div>
      {duplicates.data && duplicates.data.total > duplicates.data.groups.length && (
        <p className="text-center text-xs text-zinc-500">
          Showing the top {duplicates.data.groups.length} of {duplicates.data.total}
          {duplicates.data.capped && "+"}. Merge or dismiss these to see more.
        </p>
      )}

      <MergeDialog open={Boolean(merging)} onClose={() => setMerging(undefined)} candidates={merging ?? []} onMerged={() => setMerging(undefined)} />
    </div>
  );
}

function GroupCard({ group, onMerge }: { group: DuplicateGroup; onMerge: (contacts: MergeCandidate[]) => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(group.contacts.map((c) => c.id)));
  const dismiss = useMutation({
    mutationFn: (pairs: [string, string][]) => api("/duplicates/dismiss", { method: "POST", body: { pairs } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
  });

  const ids = group.contacts.map((c) => c.id);
  const names = new Map(group.contacts.map((c) => [c.id, c.name]));
  const multi = group.contacts.length > 2;
  const chosen = group.contacts.filter((c) => selected.has(c.id));

  /** Everyone in the group vs. everyone else (capped by the API at 45 pairs = 10 people). */
  const allPairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as [string, string])).slice(0, 45);
  const memberPairs = (id: string) => ids.filter((other) => other !== id).map((other) => [id, other] as [string, string]);

  return (
    <Card>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {group.contacts.map((c) => (
          <li key={c.id} className="group flex items-start gap-3 px-4 py-3">
            {multi && (
              <input
                type="checkbox"
                aria-label={`Include ${c.name} in the merge`}
                className="mt-2.5 accent-accent-600"
                checked={selected.has(c.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
              />
            )}
            <Avatar name={c.name} src={c.avatarUrl} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Link to={`/contacts/${c.id}`} className="truncate text-sm font-medium hover:underline">
                  {c.name}
                </Link>
                <SourceIcons sources={c.sources} />
              </div>
              {(c.title || c.company) && <div className="truncate text-xs text-zinc-500">{[c.title, c.company].filter(Boolean).join(" · ")}</div>}
              {c.identities.length > 0 && (
                <div className="truncate text-xs text-zinc-500">
                  {c.identities
                    .slice(0, 4)
                    .map((i) => i.value)
                    .join(" · ")}
                </div>
              )}
            </div>
            {multi && (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 opacity-60 group-hover:opacity-100 focus:opacity-100"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(memberPairs(c.id))}
              >
                Not this person
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="mr-auto">
          <InfoTip label="Why these were matched">
            <span className="mb-1 block font-medium">
              {group.confidence[0].toUpperCase() + group.confidence.slice(1)} confidence
            </span>
            {group.pairs.map((p) => (
              <span key={p.ids.join(":")} className="block">
                {multi && `${names.get(p.ids[0])} ↔ ${names.get(p.ids[1])}: `}
                {p.reasons.join(", ")}
              </span>
            ))}
          </InfoTip>
        </span>
        <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(allPairs)}>
          {multi ? "None of these are the same" : "Not the same person"}
        </Button>
        <Button size="sm" variant="primary" disabled={chosen.length < 2} onClick={() => onMerge(chosen)}>
          {multi ? `Merge ${chosen.length} selected…` : "Merge…"}
        </Button>
      </div>
    </Card>
  );
}
