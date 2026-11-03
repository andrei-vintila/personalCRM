import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "./api";

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const passkeysSupported = browserSupportsWebAuthn;

/** True when the person dismissed the browser's passkey prompt; not worth an error message. */
export const isCancelled = (error: unknown) => error instanceof Error && error.name === "NotAllowedError";

export async function signInWithPasskey() {
  const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>("/auth/passkey/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON });
  return api("/auth/passkey/login", { method: "POST", body: response });
}

export async function addPasskey(name: string) {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>("/passkeys/options", { method: "POST" });
  const response = await startRegistration({ optionsJSON });
  return api<Passkey>("/passkeys", { method: "POST", body: { name, response } });
}

/** A default name from the browser's platform, e.g. "Mac" or "iPhone". */
export function defaultPasskeyName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Passkey";
}
