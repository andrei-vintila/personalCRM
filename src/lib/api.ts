import type { getContactDetail, listContacts, listInteractions, listTags } from "../../server/utils/contacts";
import type { IdentityKind, InteractionType, Reminder } from "../../server/db/schema";

/** Server return types as they arrive over JSON (Dates become strings). */
type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type ContactSummary = Jsonify<Awaited<ReturnType<typeof listContacts>>[number]>;
export type ContactDetail = Jsonify<Awaited<ReturnType<typeof getContactDetail>>>;
export type InteractionItem = Jsonify<Awaited<ReturnType<typeof listInteractions>>[number]>;
export type TagCount = Jsonify<Awaited<ReturnType<typeof listTags>>[number]>;
export type ReminderItem = Jsonify<Reminder> & { contact: { id: string; name: string; avatarUrl: string | null } | null };
export type { IdentityKind, InteractionType };

export interface HomeData {
  reconnect: ContactSummary[];
  recent: InteractionItem[];
  reminders: ReminderItem[];
  birthdays: { id: string; name: string; avatarUrl: string | null; birthday: string; inDays: number; sources: string[] }[];
  /** Birthdays that passed within the span `recent` covers */
  birthdayEvents: { date: string; age: number | null; contact: { id: string; name: string; avatarUrl: string | null } }[];
  stats: { contacts: number; tracked: number | null; interactionsLast30: number };
}

export interface ContactInput {
  name: string;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
  about?: string | null;
  birthday?: string | null;
  keepInTouchDays?: number | null;
  starred?: boolean;
  archived?: boolean;
  identities?: { kind: IdentityKind; value: string; label?: string | null }[];
  tags?: string[];
}

export interface ImportContact {
  name: string;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  about?: string | null;
  birthday?: string | null;
  identities: { kind: IdentityKind; value: string }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body === undefined ? init?.headers : { "content-type": "application/json", ...init?.headers },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("prm:unauthorized"));
    throw new ApiError(res.status, payload?.message ?? res.statusText, payload?.data);
  }
  return payload as T;
}
