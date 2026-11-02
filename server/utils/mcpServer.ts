import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts, identityKinds, interactions, interactionTypes, reminders } from "../db/schema";
import { getContactDetail, listContacts, listInteractions, listTags } from "./contacts";
import type { DB } from "./db";
import { createContact, createReminder, logInteraction, updateContact } from "./mutations";

/**
 * MCP server exposing the PRM to AI assistants (Claude, ChatGPT, ...).
 * Stateless: a fresh server per request, bound to that request's database.
 * There is intentionally no delete tool.
 */
export function createMcpServer(db: DB) {
  const server = new McpServer({ name: "prm", version: "1.0.0" });

  const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  /** Compact contact shape for lists, to keep model context small. */
  const summary = (c: Awaited<ReturnType<typeof listContacts>>[number]) => ({
    id: c.id,
    name: c.name,
    title: c.title ?? undefined,
    company: c.company ?? undefined,
    location: c.location ?? undefined,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    tags: c.tags.length ? c.tags : undefined,
    sources: c.sources,
    starred: c.starred || undefined,
    lastInteractionAt: c.lastInteractionAt ?? undefined,
    keepInTouchDays: c.keepInTouchDays ?? undefined,
    reconnectDue: c.dueAt !== null && c.dueAt <= Date.now() ? true : undefined,
  });

  server.registerTool(
    "search_contacts",
    {
      title: "Search contacts",
      description:
        "Find people by name, company, title, location, email or phone. Optionally filter by tag or list starred, archived or 'reconnect' (overdue for a catch-up) contacts. Returns compact summaries with ids for get_contact.",
      inputSchema: {
        query: z.string().optional().describe("Free text, e.g. 'Acme' or 'Ana Pop'"),
        tag: z.string().optional(),
        filter: z.enum(["all", "starred", "reconnect", "archived"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
      annotations: readOnly,
    },
    async ({ query, tag, filter, limit }) => {
      const rows = await listContacts(db, { q: query, tag, filter, limit: limit ?? 20 });
      return json(rows.map(summary));
    },
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get contact details",
      description: "Everything about one person: contact details, tags, notes, open reminders and their recent timeline (emails, meetings, calls, notes).",
      inputSchema: {
        id: z.string().describe("Contact id from search_contacts"),
        timelineLimit: z.number().int().min(0).max(100).optional().describe("Default 20"),
      },
      annotations: readOnly,
    },
    async ({ id, timelineLimit }) => {
      const c = await getContactDetail(db, id);
      return json({
        id: c.id,
        name: c.name,
        title: c.title,
        company: c.company,
        location: c.location,
        birthday: c.birthday,
        about: c.about,
        tags: c.tags,
        sources: c.sources,
        starred: c.starred,
        archived: c.archived,
        keepInTouchDays: c.keepInTouchDays,
        lastInteractionAt: c.lastInteractionAt,
        nextCatchUpDue: c.dueAt ? new Date(c.dueAt).toISOString() : null,
        identities: c.identities.map((i) => ({ kind: i.kind, value: i.value, label: i.label ?? undefined })),
        openReminders: c.reminders.filter((r) => !r.completedAt).map((r) => ({ id: r.id, note: r.note, dueAt: r.dueAt })),
        timeline: c.interactions.slice(0, timelineLimit ?? 20).map((i) => ({
          type: i.type,
          occurredAt: i.occurredAt,
          title: i.title ?? undefined,
          body: i.body ?? undefined,
          source: i.source,
          with: i.contacts.filter((p) => p.id !== c.id).map((p) => p.name),
        })),
      });
    },
  );

  server.registerTool(
    "create_contact",
    {
      title: "Add a contact",
      description: "Create a person. Emails, phones and LinkedIn URLs must not already belong to someone else (search first to avoid duplicates).",
      inputSchema: {
        name: z.string().min(1).max(200),
        company: z.string().optional(),
        title: z.string().optional(),
        location: z.string().optional(),
        about: z.string().optional().describe("Notes: how you met, what they care about"),
        birthday: z.string().optional().describe("YYYY-MM-DD, or --MM-DD without year"),
        emails: z.array(z.string()).optional(),
        phones: z.array(z.string()).optional(),
        linkedin: z.string().optional().describe("Profile URL or handle"),
        tags: z.array(z.string()).optional(),
        keepInTouchDays: z.number().int().min(1).max(3650).optional().describe("Desired catch-up cadence, e.g. 30"),
      },
    },
    async ({ emails, phones, linkedin, ...fields }) => {
      const contact = await createContact(db, {
        ...fields,
        company: fields.company ?? null,
        title: fields.title ?? null,
        location: fields.location ?? null,
        about: fields.about ?? null,
        avatarUrl: null,
        identities: [
          ...(emails ?? []).map((value) => ({ kind: "email" as const, value, label: null })),
          ...(phones ?? []).map((value) => ({ kind: "phone" as const, value, label: null })),
          ...(linkedin ? [{ kind: "linkedin" as const, value: linkedin, label: null }] : []),
        ],
      });
      return json({ id: contact.id, name: contact.name });
    },
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update a contact",
      description:
        "Change fields on a person. Only the fields you pass change. `tags` replaces all tags; `addTags` adds to them. `addIdentities` adds emails/phones/URLs without removing existing ones.",
      inputSchema: {
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        company: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        about: z.string().nullable().optional(),
        birthday: z.string().nullable().optional(),
        keepInTouchDays: z.number().int().min(1).max(3650).nullable().optional().describe("null stops keep-in-touch tracking"),
        starred: z.boolean().optional(),
        archived: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        addTags: z.array(z.string()).optional(),
        addIdentities: z.array(z.object({ kind: z.enum(identityKinds), value: z.string(), label: z.string().optional() })).optional(),
      },
    },
    async ({ id, tags, addTags, addIdentities, ...fields }) => {
      const current = await getContactDetail(db, id);
      const contact = await updateContact(db, id, {
        ...fields,
        tags: tags ?? (addTags ? [...current.tags, ...addTags] : undefined),
        identities: addIdentities
          ? [
              ...current.identities.map((i) => ({ kind: i.kind, value: i.value, label: i.label })),
              ...addIdentities.map((i) => ({ ...i, label: i.label ?? null })),
            ]
          : undefined,
      });
      return json({ id: contact.id, name: contact.name, tags: contact.tags, identities: contact.identities.map((i) => `${i.kind}:${i.value}`) });
    },
  );

  server.registerTool(
    "log_interaction",
    {
      title: "Log a note or interaction",
      description:
        "Add a note, call, meeting, message or email to one or more people's timelines. This also updates when you last talked, which drives keep-in-touch reminders.",
      inputSchema: {
        contactIds: z.array(z.string()).min(1).max(50),
        type: z.enum(interactionTypes).optional().describe("Default 'note'"),
        body: z.string().max(10_000).describe("What happened or what to remember"),
        title: z.string().max(200).optional(),
        occurredAt: z.string().optional().describe("ISO date/time; defaults to now"),
      },
    },
    async ({ contactIds, type, body, title, occurredAt }) => {
      const interaction = await logInteraction(db, {
        contactIds,
        type: type ?? "note",
        body,
        title: title ?? null,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
      });
      return json({ id: interaction.id, type: interaction.type, occurredAt: interaction.occurredAt });
    },
  );

  server.registerTool(
    "search_interactions",
    {
      title: "Search the timeline",
      description: "Search notes, emails, meetings, calls and messages across everyone, or for one person. Newest first.",
      inputSchema: {
        query: z.string().optional().describe("Text to find in titles and notes"),
        contactId: z.string().optional(),
        type: z.enum(interactionTypes).optional(),
        since: z.string().optional().describe("ISO date; only interactions after it"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
      annotations: readOnly,
    },
    async ({ query, contactId, type, since, limit }) => {
      const rows = await listInteractions(db, { query, contactId, type, since: since ? new Date(since) : undefined, limit: limit ?? 20 });
      return json(
        rows.map((i) => ({
          id: i.id,
          type: i.type,
          occurredAt: i.occurredAt,
          title: i.title ?? undefined,
          body: i.body ?? undefined,
          source: i.source,
          people: i.contacts.map((c) => ({ id: c.id, name: c.name })),
        })),
      );
    },
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Create a reminder",
      description: "Remind yourself to do something, optionally about a person.",
      inputSchema: {
        note: z.string().min(1).max(2000),
        dueAt: z.string().describe("ISO date/time"),
        contactId: z.string().optional(),
      },
    },
    async ({ note, dueAt, contactId }) => {
      const reminder = await createReminder(db, { note, dueAt: new Date(dueAt), contactId: contactId ?? null });
      return json({ id: reminder.id, note: reminder.note, dueAt: reminder.dueAt });
    },
  );

  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description: "Open reminders, soonest first (or completed ones).",
      inputSchema: { status: z.enum(["open", "done"]).optional().describe("Default 'open'") },
      annotations: readOnly,
    },
    async ({ status }) => {
      const done = status === "done";
      const rows = await db.query.reminders.findMany({
        where: done ? isNotNull(reminders.completedAt) : isNull(reminders.completedAt),
        orderBy: [asc(reminders.dueAt)],
        limit: 100,
        with: { contact: { columns: { id: true, name: true } } },
      });
      return json(rows.map((r) => ({ id: r.id, note: r.note, dueAt: r.dueAt, completedAt: r.completedAt ?? undefined, contact: r.contact ?? undefined })));
    },
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Complete a reminder",
      description: "Mark a reminder as done.",
      inputSchema: { id: z.string() },
      annotations: { idempotentHint: true },
    },
    async ({ id }) => {
      const [row] = await db.update(reminders).set({ completedAt: new Date() }).where(eq(reminders.id, id)).returning({ id: reminders.id });
      return row ? json({ id: row.id, completed: true }) : { isError: true, content: [{ type: "text" as const, text: "Reminder not found" }] };
    },
  );

  server.registerTool(
    "reconnect_suggestions",
    {
      title: "Who to reconnect with",
      description: "People with a keep-in-touch goal who are overdue for a catch-up, most overdue first.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Default 10") },
      annotations: readOnly,
    },
    async ({ limit }) => json((await listContacts(db, { filter: "reconnect", limit: limit ?? 10 })).map(summary)),
  );

  server.registerTool(
    "prm_overview",
    {
      title: "PRM overview",
      description: "Totals and tags: how many contacts, how many have keep-in-touch goals or are overdue, recent activity, and every tag with its count.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const monthAgo = Date.now() - 30 * 86_400_000;
      const [[stats], tags] = await Promise.all([
        db
          .select({
            contacts: sql<number>`count(*)`,
            starred: sql<number>`sum(${contacts.starred})`,
            withKeepInTouch: sql<number>`sum(case when ${contacts.keepInTouchDays} is not null then 1 else 0 end)`,
            interactionsLast30Days: sql<number>`(select count(*) from ${interactions} where ${interactions.occurredAt} >= ${monthAgo})`,
          })
          .from(contacts)
          .where(and(eq(contacts.archived, false))),
        listTags(db),
      ]);
      const overdue = await listContacts(db, { filter: "reconnect", limit: 500 });
      return json({ ...stats, overdueForCatchUp: overdue.length, tags });
    },
  );

  return server;
}
