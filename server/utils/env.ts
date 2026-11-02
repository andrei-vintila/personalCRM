import type { H3Event } from "nitro/h3";

/** Cloudflare bindings (env) when running on Workers; undefined on Node. */
export type CloudflareBindings = Record<string, unknown> | undefined;

/** Cloudflare bindings for a request, undefined everywhere else. */
export function cloudflareEnv(event: H3Event): CloudflareBindings {
  return (event.req as { runtime?: { cloudflare?: { env?: Record<string, unknown> } } }).runtime?.cloudflare?.env;
}

/** Reads a string setting from Cloudflare vars/secrets or process.env. */
export function readEnv(bindings: CloudflareBindings, key: string): string | undefined {
  const fromCf = bindings?.[key];
  if (typeof fromCf === "string") return fromCf;
  return globalThis.process?.env?.[key];
}

export function getEnv(event: H3Event, key: string): string | undefined {
  return readEnv(cloudflareEnv(event), key);
}
