import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { Avatar, Badge, Button, Card, Empty, ErrorText } from "../components/ui";
import { MergeDialog, type MergeCandidate } from "../components/MergeDialog";

export interface DuplicatePair {
  ids: [string, string];
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  contacts: MergeCandidate[];
}

export interface DuplicatesResponse {
  total: number;
  pairs: DuplicatePair[];
}

export function useDuplicates() {
  return useQuery({ queryKey: ["duplicates"], queryFn: () => api<DuplicatesResponse>("/duplicates") });
}

export function DuplicatesPage() {
  const duplicates = useDuplicates();
  const [merging, setMerging] = useState<MergeCandidate[]>();

  return (
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <ArrowLeft className="size-3.5" /> Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Possible duplicates</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Found by similar names, nicknames, phone numbers in different formats and matching email usernames.
        </p>
      </div>

      <ErrorText error={duplicates.error} />
      {duplicates.data?.pairs.length === 0 && (
        <Card>
          <Empty>No duplicates found.</Empty>
        </Card>
      )}
      <div className="space-y-3">
        {duplicates.data?.pairs.map((pair) => (
          <PairCard key={pair.ids.join(":")} pair={pair} onMerge={() => setMerging(pair.contacts)} />
        ))}
      </div>
      {duplicates.data && duplicates.data.total > duplicates.data.pairs.length && (
        <p className="text-center text-xs text-zinc-500">
          Showing the top {duplicates.data.pairs.length} of {duplicates.data.total}. Merge or dismiss these to see more.
        </p>
      )}

      <MergeDialog open={Boolean(merging)} onClose={() => setMerging(undefined)} candidates={merging ?? []} onMerged={() => setMerging(undefined)} />
    </div>
  );
}

function PairCard({ pair, onMerge }: { pair: DuplicatePair; onMerge: () => void }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => api("/duplicates/dismiss", { method: "POST", body: { contactIds: pair.ids } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
  });
  const tone = pair.confidence === "high" ? "warn" : pair.confidence === "medium" ? "accent" : "neutral";

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{pair.confidence}</Badge>
        <span className="text-xs text-zinc-500">{pair.reasons.join(" · ")}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {pair.contacts.map((c) => (
          <Link
            key={c.id}
            to={`/contacts/${c.id}`}
            className="flex gap-3 rounded-lg p-2 ring-1 ring-zinc-100 hover:bg-zinc-50 dark:ring-zinc-800 dark:hover:bg-zinc-800/50"
          >
            <Avatar name={c.name} src={c.avatarUrl} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-sm font-medium">{c.name}</div>
              {(c.title || c.company) && <div className="truncate text-xs text-zinc-500">{[c.title, c.company].filter(Boolean).join(" · ")}</div>}
              {c.identities.slice(0, 3).map((i) => (
                <div key={`${i.kind}:${i.value}`} className="truncate text-xs text-zinc-500">
                  {i.value}
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Not the same person
        </Button>
        <Button size="sm" variant="primary" onClick={onMerge}>
          Merge…
        </Button>
      </div>
    </Card>
  );
}
