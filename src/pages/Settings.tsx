import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Contact, Copy, Fingerprint, KeyRound, Laptop, Mail, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { addPasskey, defaultPasskeyName, isCancelled, passkeysSupported, type Passkey } from "../lib/passkeys";
import { relativeTime } from "../lib/format";
import { Badge, Button, Card, CardHeader, Empty, ErrorText, Input } from "../components/ui";

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

      <PasskeysCard />
      <ApiTokensCard />
      <McpCard />
      <MacConnectorCard />
    </div>
  );
}

/** Gmail allows 15,000 quota units per user per minute; a step costs about 130, so ~40 steps a minute leaves plenty of room. */
const GMAIL_STEP_MS = 1500;
/** How many times to wait out a rate limit before giving up on "Sync now". */
const MAX_RATE_LIMIT_WAITS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function AccountRow({ account, autoStart }: { account: Account; autoStart: boolean }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ kind: SyncKind; steps: number; contacts: number; interactions: number }>();
  const [running, setRunning] = useState(false);
  const [syncError, setSyncError] = useState<unknown>();
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const refresh = () => queryClient.invalidateQueries();

  const syncAll = async () => {
    setRunning(true);
    setSyncError(undefined);
    let contacts = 0;
    let interactions = 0;
    let rateLimitWaits = 0;
    const step = async (kind: SyncKind): Promise<StepResult> => {
      for (;;) {
        try {
          return await api<StepResult>(`/integrations/${account.id}/sync`, { method: "POST", body: { kind } });
        } catch (e) {
          // Google's quota is per minute: wait it out and carry on from the same cursor.
          if (!(e instanceof ApiError && e.status === 429) || ++rateLimitWaits > MAX_RATE_LIMIT_WAITS) throw e;
          setWaiting(true);
          await sleep(((e.data as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60) * 1000);
          setWaiting(false);
        }
      }
    };
    try {
      for (const kind of ["contacts", "calendar", "gmail"] as SyncKind[]) {
        for (let steps = 1; steps <= 2000; steps++) {
          const startedAt = Date.now();
          const result = await step(kind);
          contacts += result.contactsCreated;
          interactions += result.interactions;
          setProgress({ kind, steps, contacts, interactions });
          if (result.done) break;
          if (kind === "gmail") await sleep(GMAIL_STEP_MS - (Date.now() - startedAt));
        }
      }
    } catch (e) {
      setSyncError(e);
    } finally {
      setRunning(false);
      setWaiting(false);
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
          {running
            ? waiting
              ? `Google asked to slow down. Continuing ${sourceMeta[progress.kind].label} in a minute… `
              : `Syncing ${sourceMeta[progress.kind].label} (page ${progress.steps})… `
            : "Sync finished: "}
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

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-1 rounded-lg bg-zinc-100 py-1 pr-1 pl-3 dark:bg-zinc-800">
      <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 text-xs whitespace-pre">{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

function PasskeysCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultPasskeyName);
  const passkeys = useQuery({ queryKey: ["passkeys"], queryFn: () => api<Passkey[]>("/passkeys") });

  const add = useMutation({
    mutationFn: () => addPasskey(name.trim()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] }),
  });

  return (
    <Card>
      <CardHeader title="Passkeys" icon={<Fingerprint className="size-4 text-accent-600" />} />
      <div className="space-y-3 p-4">
        <p className="text-sm text-zinc-500">
          Sign in with Touch ID, Face ID, your phone or a security key instead of the password. The password keeps working too.
        </p>
        {passkeysSupported() ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Input placeholder="Passkey name, e.g. MacBook" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="primary" className="shrink-0 whitespace-nowrap" disabled={!name.trim() || add.isPending}>
              Add passkey
            </Button>
          </form>
        ) : (
          <p className="text-sm text-zinc-500">This browser doesn't support passkeys.</p>
        )}
        <ErrorText error={(isCancelled(add.error) ? null : add.error) ?? remove.error} />
      </div>
      {passkeys.data && passkeys.data.length > 0 && (
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
          {passkeys.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-zinc-500">Added {relativeTime(p.createdAt)}</span>
              <span className="ml-auto text-xs text-zinc-500">{p.lastUsedAt ? `Used ${relativeTime(p.lastUsedAt)}` : "Never used"}</span>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Remove ${p.name}`}
                onClick={() => confirm(`Remove “${p.name}”? It can no longer sign in to PRM.`) && remove.mutate(p.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ApiTokensCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<ApiToken & { token: string }>();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<ApiToken[]>("/tokens") });

  const create = useMutation({
    mutationFn: () => api<ApiToken & { token: string }>("/tokens", { method: "POST", body: { name } }),
    onSuccess: (token) => {
      setCreated(token);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <Card>
      <CardHeader title="API tokens" icon={<KeyRound className="size-4 text-accent-600" />} />
      <div className="space-y-3 p-4">
        <p className="text-sm text-zinc-500">
          For AI assistants (MCP), the Mac connector and scripts. Send as <code>Authorization: Bearer …</code>. A token can read and change
          your PRM but can't create other tokens.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input placeholder="Token name, e.g. Claude or MacBook" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" className="shrink-0 whitespace-nowrap" disabled={!name.trim() || create.isPending}>
            Create token
          </Button>
        </form>
        <ErrorText error={create.error ?? revoke.error} />
        {created && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900">
            <p className="font-medium">Copy “{created.name}” now. It won't be shown again.</p>
            <CodeBlock>{created.token}</CodeBlock>
          </div>
        )}
      </div>
      {tokens.data && tokens.data.length > 0 && (
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
          {tokens.data.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{t.name}</span>
              <code className="text-xs text-zinc-500">{t.prefix}…</code>
              <span className="ml-auto text-xs text-zinc-500">{t.lastUsedAt ? `Used ${relativeTime(t.lastUsedAt)}` : "Never used"}</span>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Revoke ${t.name}`}
                onClick={() => confirm(`Revoke “${t.name}”? Anything using it stops working.`) && revoke.mutate(t.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function McpCard() {
  const url = `${window.location.origin}/mcp`;
  return (
    <Card>
      <CardHeader title="AI assistants (MCP)" icon={<Sparkles className="size-4 text-accent-600" />} />
      <div className="space-y-3 p-4 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          Let Claude or ChatGPT search people, read timelines, log notes and set reminders. Create an API token above, then add this
          server. There's no delete tool.
        </p>
        <CodeBlock>{url}</CodeBlock>
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Claude Code</p>
        <CodeBlock>{`claude mcp add --transport http prm ${url} --header "Authorization: Bearer <token>"`}</CodeBlock>
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Claude Desktop and other clients (claude_desktop_config.json)</p>
        <CodeBlock>{JSON.stringify(
          { mcpServers: { "prm": { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization: Bearer <token>"] } } },
          null,
          2,
        )}</CodeBlock>
      </div>
    </Card>
  );
}

function MacConnectorCard() {
  const origin = window.location.origin;
  return (
    <Card>
      <CardHeader title="Phone calls and WhatsApp (Mac)" icon={<Laptop className="size-4 text-accent-600" />} />
      <div className="space-y-3 p-4 text-sm text-zinc-600 dark:text-zinc-400">
        <p>
          Your call history (Phone, FaceTime, WhatsApp calls) and WhatsApp chats only exist on your Mac. The connector script reads them
          locally and sends timeline entries here. For WhatsApp it sends who and when, never message text.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Give your terminal app Full Disk Access (System Settings → Privacy & Security → Full Disk Access).</li>
          <li>Create an API token above.</li>
          <li>From the project folder, preview what it would send, then run it:</li>
        </ol>
        <CodeBlock>{`npm run connector -- --dry-run`}</CodeBlock>
        <CodeBlock>{`PRM_URL=${origin} PRM_TOKEN=<token> npm run connector`}</CodeBlock>
        <p>To keep it in sync, schedule it with launchd (see the README). It only sends what's new since the last run.</p>
      </div>
    </Card>
  );
}
