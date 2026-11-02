import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Contact, Mail, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Badge, Button, Card, CardHeader, Empty, ErrorText } from "../components/ui";

type SyncKind = "contacts" | "calendar" | "gmail";

interface Account {
  id: string;
  provider: "google";
  accountEmail: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  sources: { kind: SyncKind; initialDone: boolean; lastRunAt: number | null }[];
}

interface IntegrationsResponse {
  google: { configured: boolean; redirectUri: string };
  accounts: Account[];
}

interface StepResult {
  kind: SyncKind;
  done: boolean;
  processed: number;
  contactsCreated: number;
  interactions: number;
}

const sourceMeta: Record<SyncKind, { label: string; icon: typeof Mail; detail: string }> = {
  contacts: { label: "Contacts", icon: Contact, detail: "Your Google address book" },
  calendar: { label: "Calendar", icon: CalendarDays, detail: "Past meetings with up to 15 people" },
  gmail: { label: "Gmail", icon: Mail, detail: "Threads with people (headers and snippets only)" },
};

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const data = useQuery({ queryKey: ["integrations"], queryFn: () => api<IntegrationsResponse>("/integrations") });
  const connected = params.get("connected");
  const error = params.get("error");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {(connected || error) && (
        <div
          className={
            error
              ? "flex items-start justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300"
              : "flex items-start justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          }
        >
          <span>{error ?? "Google account connected. Run the first sync below; after that it stays up to date every 10 minutes."}</span>
          <button className="text-xs underline" onClick={() => setParams({}, { replace: true })}>
            Dismiss
          </button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Google"
          action={
            data.data?.google.configured && (
              <a href="/api/integrations/google/connect">
                <Button variant="primary" size="sm">
                  Connect Google account
                </Button>
              </a>
            )
          }
        />
        {data.error && (
          <div className="p-4">
            <ErrorText error={data.error} />
          </div>
        )}
        {data.data && !data.data.google.configured && <GoogleSetup redirectUri={data.data.google.redirectUri} />}
        {data.data?.google.configured && data.data.accounts.length === 0 && (
          <Empty>Connect an account to bring in your contacts, meetings and email threads.</Empty>
        )}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.data?.accounts.map((account) => (
            <AccountRow key={account.id} account={account} autoStart={account.id === connected} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AccountRow({ account, autoStart }: { account: Account; autoStart: boolean }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ kind: SyncKind; steps: number; contacts: number; interactions: number }>();
  const [running, setRunning] = useState(false);
  const [syncError, setSyncError] = useState<unknown>();
  const [started, setStarted] = useState(false);

  const refresh = () => queryClient.invalidateQueries();

  const syncAll = async () => {
    setRunning(true);
    setSyncError(undefined);
    let contacts = 0;
    let interactions = 0;
    try {
      for (const kind of ["contacts", "calendar", "gmail"] as SyncKind[]) {
        for (let steps = 1; steps <= 2000; steps++) {
          const result = await api<StepResult>(`/integrations/${account.id}/sync`, { method: "POST", body: { kind } });
          contacts += result.contactsCreated;
          interactions += result.interactions;
          setProgress({ kind, steps, contacts, interactions });
          if (result.done) break;
        }
      }
    } catch (e) {
      setSyncError(e);
    } finally {
      setRunning(false);
      refresh();
    }
  };

  // Kick off the first sync right after connecting.
  if (autoStart && !started && !running) {
    setStarted(true);
    queueMicrotask(syncAll);
  }

  const toggle = useMutation({
    mutationFn: () => api(`/integrations/${account.id}`, { method: "PATCH", body: { enabled: !account.enabled } }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/integrations/${account.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {account.accountEmail}
            {!account.enabled && <Badge>paused</Badge>}
          </div>
          <div className="text-xs text-zinc-500">
            {account.lastSyncedAt ? `Last synced ${relativeTime(account.lastSyncedAt)}` : "Not synced yet"}
          </div>
        </div>
        <Button size="sm" variant="primary" disabled={running} onClick={syncAll}>
          <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} />
          {running ? "Syncing…" : "Sync now"}
        </Button>
        <Button size="sm" onClick={() => toggle.mutate()}>
          {account.enabled ? "Pause auto-sync" : "Resume auto-sync"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            confirm(`Disconnect ${account.accountEmail}? Contacts and history already synced are kept.`) && disconnect.mutate()
          }
        >
          Disconnect
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {account.sources.map((source) => {
          const { label, icon: Icon, detail } = sourceMeta[source.kind];
          return (
            <div key={source.kind} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="size-3.5 text-zinc-500" /> {label}
                {!source.initialDone && <Badge tone="warn">needs first sync</Badge>}
              </div>
              <div className="text-xs text-zinc-500">{detail}</div>
              <div className="text-xs text-zinc-500">{source.lastRunAt ? `Checked ${relativeTime(source.lastRunAt)}` : "Never checked"}</div>
            </div>
          );
        })}
      </div>

      {progress && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {running ? `Syncing ${sourceMeta[progress.kind].label} (page ${progress.steps})… ` : "Sync finished: "}
          {progress.contacts} new contacts, {progress.interactions} interactions.
        </p>
      )}
      <ErrorText error={syncError} />
      {account.lastError && !running && <p className="text-sm text-amber-700 dark:text-amber-400">{account.lastError}</p>}
    </li>
  );
}

function GoogleSetup({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="space-y-2 p-4 text-sm text-zinc-600 dark:text-zinc-400">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">Google isn't configured on the server yet.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>In Google Cloud Console, create a project and enable the People, Gmail and Google Calendar APIs.</li>
        <li>Configure the OAuth consent screen (External, add yourself as a test user, or publish it).</li>
        <li>
          Create an OAuth client of type <em>Web application</em> with this redirect URI:
          <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 text-xs break-all dark:bg-zinc-800">{redirectUri}</code>
        </li>
        <li>
          Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> on the server and restart it.
        </li>
      </ol>
    </div>
  );
}
