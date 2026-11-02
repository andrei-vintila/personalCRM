import { relations, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    name: text("name").notNull(),
    company: text("company"),
    title: text("title"),
    location: text("location"),
    avatarUrl: text("avatar_url"),
    about: text("about"),
    /** YYYY-MM-DD, or --MM-DD when the year is unknown */
    birthday: text("birthday"),
    /** Desired contact cadence in days; null = no keep-in-touch tracking */
    keepInTouchDays: integer("keep_in_touch_days"),
    /** Denormalized max(interactions.occurred_at) for fast "reconnect" queries */
    lastInteractionAt: integer("last_interaction_at", { mode: "timestamp_ms" }),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index("contacts_name_idx").on(t.name), index("contacts_last_interaction_idx").on(t.lastInteractionAt)],
);

export const identityKinds = ["email", "phone", "linkedin", "twitter", "url"] as const;
export type IdentityKind = (typeof identityKinds)[number];

/**
 * Every way we know to reach or recognise a person. The normalized (kind, value)
 * pair is unique, which is what lets imports and syncs de-duplicate contacts.
 */
export const contactIdentities = sqliteTable(
  "contact_identities",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: identityKinds }).notNull(),
    value: text("value").notNull(),
    label: text("label"),
    source: text("source").notNull().default("manual"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("identities_kind_value_uq").on(t.kind, t.value), index("identities_contact_idx").on(t.contactId)],
);

export const tags = sqliteTable("tags", {
  id: id(),
  name: text("name").notNull().unique(),
  color: text("color"),
});

export const contactTags = sqliteTable(
  "contact_tags",
  {
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag_idx").on(t.tagId)],
);

export const interactionTypes = ["note", "email", "meeting", "call", "message", "other"] as const;
export type InteractionType = (typeof interactionTypes)[number];

export const interactions = sqliteTable(
  "interactions",
  {
    id: id(),
    type: text("type", { enum: interactionTypes }).notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    title: text("title"),
    body: text("body"),
    /** Where it came from: manual, gmail, gcal, imessage, ... */
    source: text("source").notNull().default("manual"),
    /** Id in the source system, so re-syncing is idempotent */
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("interactions_source_external_uq").on(t.source, t.externalId), index("interactions_occurred_idx").on(t.occurredAt)],
);

export const interactionContacts = sqliteTable(
  "interaction_contacts",
  {
    interactionId: text("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.interactionId, t.contactId] }), index("interaction_contacts_contact_idx").on(t.contactId)],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: id(),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    note: text("note").notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("reminders_due_idx").on(t.dueAt)],
);

/**
 * Connected accounts (currently Google). Tokens are encrypted at rest; `state`
 * holds per-source sync cursors as JSON.
 */
export const integrations = sqliteTable(
  "integrations",
  {
    id: id(),
    provider: text("provider", { enum: ["google"] }).notNull(),
    accountEmail: text("account_email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    scopes: text("scopes").notNull(),
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_provider_account_uq").on(t.provider, t.accountEmail)],
);

export const contactsRelations = relations(contacts, ({ many }) => ({
  identities: many(contactIdentities),
  tags: many(contactTags),
  interactions: many(interactionContacts),
  reminders: many(reminders),
}));

export const contactIdentitiesRelations = relations(contactIdentities, ({ one }) => ({
  contact: one(contacts, { fields: [contactIdentities.contactId], references: [contacts.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contacts: many(contactTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
  tag: one(tags, { fields: [contactTags.tagId], references: [tags.id] }),
}));

export const interactionsRelations = relations(interactions, ({ many }) => ({
  contacts: many(interactionContacts),
}));

export const interactionContactsRelations = relations(interactionContacts, ({ one }) => ({
  interaction: one(interactions, { fields: [interactionContacts.interactionId], references: [interactions.id] }),
  contact: one(contacts, { fields: [interactionContacts.contactId], references: [contacts.id] }),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  contact: one(contacts, { fields: [reminders.contactId], references: [contacts.id] }),
}));

export type Contact = typeof contacts.$inferSelect;
export type ContactIdentity = typeof contactIdentities.$inferSelect;
export type Interaction = typeof interactions.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
