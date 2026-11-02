import { z } from "zod";
import { identityKinds, interactionTypes } from "../db/schema";

const optionalText = z
  .string()
  .trim()
  .max(10_000)
  .nullish()
  .transform((v) => (v ? v : null));

export const identitySchema = z.object({
  kind: z.enum(identityKinds),
  value: z.string().trim().min(1).max(500),
  label: optionalText,
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: optionalText,
  title: optionalText,
  location: optionalText,
  avatarUrl: optionalText,
  about: optionalText,
  birthday: z
    .string()
    .regex(/^(\d{4}|-)-\d{2}-\d{2}$/, "Use YYYY-MM-DD or --MM-DD")
    .nullish()
    .or(z.literal("").transform(() => null)),
  keepInTouchDays: z.number().int().min(1).max(3650).nullish(),
  starred: z.boolean().optional(),
  archived: z.boolean().optional(),
  identities: z.array(identitySchema).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
});

export const contactPatchSchema = contactInputSchema.partial();

export const interactionInputSchema = z.object({
  type: z.enum(interactionTypes),
  occurredAt: z.coerce.date().optional(),
  title: optionalText,
  body: optionalText,
  contactIds: z.array(z.string().min(1)).min(1).max(50),
});

export const reminderInputSchema = z.object({
  contactId: z.string().min(1).nullish(),
  dueAt: z.coerce.date(),
  note: z.string().trim().min(1).max(2000),
});

export const reminderPatchSchema = z.object({
  dueAt: z.coerce.date().optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  completed: z.boolean().optional(),
});


export const loginSchema = z.object({ password: z.string().min(1) });

export const importContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: optionalText,
  title: optionalText,
  location: optionalText,
  about: optionalText,
  birthday: z
    .string()
    .regex(/^(\d{4}|-)-\d{2}-\d{2}$/)
    .nullish()
    .catch(null),
  identities: z.array(identitySchema).max(20).default([]),
});

export const importBatchSchema = z.object({
  source: z.string().trim().min(1).max(40),
  tag: z.string().trim().max(50).nullish(),
  contacts: z.array(importContactSchema).min(1).max(25),
});
