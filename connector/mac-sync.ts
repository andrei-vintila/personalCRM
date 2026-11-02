/**
 * Mac connector: syncs phone/FaceTime call history and WhatsApp activity into the CRM.
 *
 * These live only on your Mac (no server API exists), so this script reads the local
 * databases and pushes timeline entries to /api/import/interactions with an API token.
 * WhatsApp sync is metadata only (who, when, how many messages); message text is never read.
 *
 *   CRM_URL=https://crm.example.com CRM_TOKEN=crm_… node connector/mac-sync.ts [--dry-run]
 *
 * Needs Full Disk Access for the app running it (Terminal, iTerm, or node itself under launchd):
 * System Settings → Privacy & Security → Full Disk Access.
 *
 * Options:
 *   --dry-run            Read and summarize; send nothing, save no state
 *   --only calls|whatsapp
 *   --since-days N       First-run backfill window (default 180)
 *   --calls-db PATH      Override CallHistory.storedata location
 *   --whatsapp-db PATH   Override ChatStorage.sqlite location
 *   --state PATH         Where sync progress is kept (default ~/.config/personal-crm/connector.json)
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const HOME = homedir();
const DEFAULT_CALLS_DB = join(HOME, "Library/Application Support/CallHistoryDB/CallHistory.storedata");
const DEFAULT_WHATSAPP_DB = join(HOME, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
/** Core Data stores dates as seconds since 2001-01-01. */
const CORE_DATA_EPOCH_MS = 978_307_200_000;
const DAY_MS = 86_400_000;
const BATCH = 25;
const MAX_PARTICIPANTS = 20;

interface Participant {
  kind: "email" | "phone";
  value: string;
  name?: string | null;
  create: boolean;
}

interface Item {
  externalId: string;
  type: "call" | "message";
  occurredAt: string;
  title: string;
  body?: string | null;
  participants: Participant[];
}

interface State {
  calls?: { lastDate: number };
  whatsapp?: { lastDate: number };
}

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    only: { type: "string" },
    "since-days": { type: "string", default: "180" },
    "calls-db": { type: "string", default: DEFAULT_CALLS_DB },
    "whatsapp-db": { type: "string", default: DEFAULT_WHATSAPP_DB },
    state: { type: "string", default: join(HOME, ".config/personal-crm/connector.json") },
  },
});

const dryRun = args["dry-run"];
const crmUrl = process.env.CRM_URL?.replace(/\/+$/, "");
const crmToken = process.env.CRM_TOKEN;
if (!dryRun && (!crmUrl || !crmToken)) {
  console.error("Set CRM_URL and CRM_TOKEN (create a token under Settings → API tokens), or use --dry-run.");
  process.exit(1);
}

const state: State = existsSync(args.state!) ? JSON.parse(readFileSync(args.state!, "utf8")) : {};
const backfillFrom = Date.now() - Number(args["since-days"]) * DAY_MS;

/** Opens a copy of a live SQLite database (plus WAL files) so we never lock or modify it. */
function openSnapshot(path: string): { db: DatabaseSync; cleanup: () => void } | null {
  if (!existsSync(path)) return null;
  const dir = mkdtempSync(join(tmpdir(), "crm-connector-"));
  const copy = join(dir, "db.sqlite");
  try {
    copyFileSync(path, copy);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error(`No permission to read ${path}. Grant Full Disk Access to the app running this script.`);
    }
    throw error;
  }
  return { db: new DatabaseSync(copy, { readOnly: true }), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function columns(db: DatabaseSync, table: string) {
  return new Set((db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

const fromCoreData = (seconds: number) => CORE_DATA_EPOCH_MS + seconds * 1000;
const toCoreData = (ms: number) => (ms - CORE_DATA_EPOCH_MS) / 1000;

// ---------------------------------------------------------------------------
// Calls (Phone, FaceTime, and VoIP apps that use CallKit, e.g. WhatsApp calls)

function readCalls(path: string, since: number) {
  const snapshot = openSnapshot(path);
  if (!snapshot) return null;
  try {
    const cols = columns(snapshot.db, "ZCALLRECORD");
    if (!cols.has("ZADDRESS") || !cols.has("ZDATE")) throw new Error("Unrecognized CallHistory database (no ZCALLRECORD table)");
    const opt = (name: string) => (cols.has(name) ? name : "NULL");
    const rows = snapshot.db
      .prepare(
        `select ${opt("ZUNIQUE_ID")} as id, ZADDRESS as address, ${opt("ZNAME")} as name, ZDATE as date,
                ${opt("ZDURATION")} as duration, ${opt("ZORIGINATED")} as originated, ${opt("ZSERVICE_PROVIDER")} as provider,
                ${opt("ZCALLTYPE")} as callType
         from ZCALLRECORD where ZDATE > ? order by ZDATE`,
      )
      .all(toCoreData(since)) as {
      id: string | null;
      address: string | null;
      name: string | null;
      date: number;
      duration: number | null;
      originated: number | null;
      provider: string | null;
      callType: number | null;
    }[];

    const items: Item[] = [];
    let lastDate = since;
    for (const r of rows) {
      const at = fromCoreData(r.date);
      lastDate = Math.max(lastDate, at);
      // Missed and unanswered calls aren't conversations.
      if (!r.address || !r.duration || r.duration <= 0) continue;
      const address = String(r.address).trim();
      const isEmail = address.includes("@");
      if (!isEmail && address.replace(/\D/g, "").length < 6) continue;

      const kind = r.provider?.includes("FaceTime") ? (r.callType === 8 ? "FaceTime video" : "FaceTime audio") : r.provider?.includes("whatsapp") ? "WhatsApp call" : "call";
      const minutes = Math.max(1, Math.round(r.duration / 60));
      items.push({
        externalId: r.id ?? `${address}:${r.date}`,
        type: "call",
        occurredAt: new Date(at).toISOString(),
        title: `${r.originated ? "Outgoing" : "Incoming"} ${kind} · ${minutes} min`,
        // A cached name means the number is in your Mac's contacts: worth creating a contact for.
        participants: [{ kind: isEmail ? "email" : "phone", value: address, name: r.name, create: Boolean(r.name) }],
      });
    }
    return { items, lastDate, scanned: rows.length };
  } finally {
    snapshot.db.close();
    snapshot.cleanup();
  }
}

// ---------------------------------------------------------------------------
// WhatsApp (Mac app's local store): one timeline entry per chat per day, no message text.

function jidToPhone(jid: string | null) {
  if (!jid?.endsWith("@s.whatsapp.net")) return null; // groups, broadcasts and anonymized @lid ids have no number
  const digits = jid.split("@")[0].replace(/\D/g, "");
  return digits.length >= 6 ? `+${digits}` : null;
}

function readWhatsApp(path: string, since: number) {
  const snapshot = openSnapshot(path);
  if (!snapshot) return null;
  try {
    for (const table of ["ZWAMESSAGE", "ZWACHATSESSION"]) {
      if (!columns(snapshot.db, table).size) throw new Error(`Unrecognized WhatsApp database (no ${table} table)`);
    }
    const hasMembers = columns(snapshot.db, "ZWAGROUPMEMBER").size > 0;
    // Re-read whole days so per-day message counts stay complete across runs.
    const fromDay = Math.floor(since / DAY_MS) * DAY_MS;
    const rows = snapshot.db
      .prepare(
        `select m.ZMESSAGEDATE as date, m.ZISFROMME as fromMe, s.ZCONTACTJID as chatJid, s.ZPARTNERNAME as chatName,
                ${hasMembers ? "gm.ZMEMBERJID" : "NULL"} as memberJid, ${hasMembers ? "gm.ZCONTACTNAME" : "NULL"} as memberName
         from ZWAMESSAGE m
         join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION
         ${hasMembers ? "left join ZWAGROUPMEMBER gm on gm.Z_PK = m.ZGROUPMEMBER" : ""}
         where m.ZMESSAGEDATE > ? order by m.ZMESSAGEDATE`,
      )
      .all(toCoreData(fromDay)) as {
      date: number;
      fromMe: number;
      chatJid: string | null;
      chatName: string | null;
      memberJid: string | null;
      memberName: string | null;
    }[];

    const days = new Map<
      string,
      { chatJid: string; chatName: string | null; isGroup: boolean; at: number; count: number; mine: number; members: Map<string, string | null> }
    >();
    let lastDate = since;
    for (const r of rows) {
      if (!r.chatJid || r.chatJid.endsWith("@broadcast") || r.chatJid.startsWith("status@")) continue;
      const at = fromCoreData(r.date);
      lastDate = Math.max(lastDate, at);
      const key = `${r.chatJid}:${new Date(at).toISOString().slice(0, 10)}`;
      let day = days.get(key);
      if (!day) {
        day = { chatJid: r.chatJid, chatName: r.chatName, isGroup: r.chatJid.endsWith("@g.us"), at, count: 0, mine: 0, members: new Map() };
        days.set(key, day);
      }
      day.at = Math.max(day.at, at);
      day.count++;
      if (r.fromMe) day.mine++;
      else if (day.isGroup) {
        const phone = jidToPhone(r.memberJid);
        if (phone) day.members.set(phone, r.memberName);
      }
    }

    const items: Item[] = [];
    for (const [key, d] of days) {
      const participants: Participant[] = d.isGroup
        ? [...d.members].slice(0, MAX_PARTICIPANTS).map(([value, name]) => ({ kind: "phone" as const, value, name, create: false }))
        : jidToPhone(d.chatJid)
          ? // People you wrote to become contacts; inbound-only chats just link.
            [{ kind: "phone" as const, value: jidToPhone(d.chatJid)!, name: d.chatName, create: d.mine > 0 }]
          : [];
      if (participants.length === 0) continue;
      const counts = `${d.count} message${d.count === 1 ? "" : "s"}`;
      items.push({
        externalId: `wa:${key}`,
        type: "message",
        occurredAt: new Date(d.at).toISOString(),
        title: d.isGroup ? `WhatsApp group${d.chatName ? ` “${d.chatName}”` : ""} · ${counts}` : `WhatsApp · ${counts}`,
        participants,
      });
    }
    return { items, lastDate, scanned: rows.length };
  } finally {
    snapshot.db.close();
    snapshot.cleanup();
  }
}

// ---------------------------------------------------------------------------

async function push(source: string, items: Item[]) {
  let interactions = 0;
  let contactsCreated = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const res = await fetch(`${crmUrl}/api/import/interactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${crmToken}`, "content-type": "application/json" },
      body: JSON.stringify({ source, items: items.slice(i, i + BATCH) }),
    });
    if (!res.ok) throw new Error(`CRM responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const result = (await res.json()) as { interactions: number; contactsCreated: number };
    interactions += result.interactions;
    contactsCreated += result.contactsCreated;
  }
  return { interactions, contactsCreated };
}

function saveState() {
  mkdirSync(dirname(args.state!), { recursive: true });
  writeFileSync(args.state!, JSON.stringify(state, null, 2));
}

const sources = [
  { key: "calls" as const, source: "calls", label: "Calls", read: () => readCalls(args["calls-db"]!, state.calls?.lastDate ?? backfillFrom) },
  { key: "whatsapp" as const, source: "whatsapp", label: "WhatsApp", read: () => readWhatsApp(args["whatsapp-db"]!, state.whatsapp?.lastDate ?? backfillFrom) },
].filter((s) => !args.only || s.key === args.only);

let failed = false;
for (const s of sources) {
  try {
    const result = s.read();
    if (!result) {
      console.log(`${s.label}: database not found, skipping`);
      continue;
    }
    const people = new Set(result.items.flatMap((i) => i.participants.map((p) => p.value))).size;
    const summary = `${s.label}: ${result.scanned} records read → ${result.items.length} timeline entries with ${people} people`;
    if (dryRun) {
      console.log(`${summary} (dry run, nothing sent)`);
      continue;
    }
    const pushed = await push(s.source, result.items);
    state[s.key] = { lastDate: result.lastDate };
    saveState();
    console.log(`${summary}; CRM linked ${pushed.interactions}, created ${pushed.contactsCreated} contacts`);
  } catch (error) {
    failed = true;
    console.error(`${s.label}: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
