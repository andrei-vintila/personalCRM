import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq } from "drizzle-orm";
import { getSession, HTTPError, updateSession, type H3Event } from "nitro/h3";
import { passkeys } from "../db/schema";
import { sessionConfig, type SessionData } from "./auth";
import type { DB } from "./db";
import { getEnv } from "./env";

/** How long a challenge stays valid between the options and verify calls. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The relying party is the app's own origin: APP_URL when set (needed behind a
 * proxy that rewrites the host or scheme), the request origin otherwise. Passkeys
 * are bound to its hostname, so moving to another domain needs new passkeys.
 */
function relyingParty(event: H3Event) {
  const origin = new URL(getEnv(event, "APP_URL") ?? event.url.origin).origin;
  return { origin, rpID: new URL(origin).hostname };
}

/** The pending challenge lives in the sealed session cookie, so no table is needed. */
async function storeChallenge(event: H3Event, challenge: string) {
  await updateSession<SessionData>(event, await sessionConfig(event), { challenge, challengeExpires: Date.now() + CHALLENGE_TTL_MS });
}

async function takeChallenge(event: H3Event): Promise<string> {
  const config = await sessionConfig(event);
  const { challenge, challengeExpires } = (await getSession<SessionData>(event, config)).data;
  await updateSession<SessionData>(event, config, { challenge: undefined, challengeExpires: undefined });
  if (!challenge || !challengeExpires || challengeExpires < Date.now()) {
    throw new HTTPError({ status: 400, message: "The passkey request expired. Try again." });
  }
  return challenge;
}

const splitTransports = (value: string | null) => (value ? value.split(",") : undefined);

export function listPasskeys(db: DB) {
  return db
    .select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .orderBy(passkeys.createdAt);
}

export async function registrationOptions(event: H3Event, db: DB) {
  const { rpID } = relyingParty(event);
  const existing = await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys);
  const options = await generateRegistrationOptions({
    rpName: "PRM",
    rpID,
    userName: "owner",
    userDisplayName: "PRM",
    // Single-user app: a fixed user handle lets authenticators replace an old PRM passkey.
    userID: new TextEncoder().encode("prm-owner"),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: splitTransports(p.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await storeChallenge(event, options.challenge);
  return options;
}

export async function registerPasskey(event: H3Event, db: DB, name: string, response: RegistrationResponseJSON) {
  const { origin, rpID } = relyingParty(event);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: await takeChallenge(event),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  }).catch((error: Error) => {
    throw new HTTPError({ status: 400, message: error.message });
  });
  if (!verification.verified) throw new HTTPError({ status: 400, message: "Passkey could not be verified" });

  const { credential } = verification.registrationInfo;
  const [row] = await db
    .insert(passkeys)
    .values({
      id: credential.id,
      name,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.join(",") || null,
    })
    .returning({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt });
  return row;
}

/** Options for a discoverable-credential sign-in: the authenticator offers its PRM passkeys. */
export async function authenticationOptions(event: H3Event) {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(event).rpID, userVerification: "preferred" });
  await storeChallenge(event, options.challenge);
  return options;
}

/** Verifies a sign-in assertion and returns the passkey it used. */
export async function verifyPasskeyLogin(event: H3Event, db: DB, response: AuthenticationResponseJSON) {
  const expectedChallenge = await takeChallenge(event);
  const [passkey] = await db.select().from(passkeys).where(eq(passkeys.id, response.id));
  if (!passkey) throw new HTTPError({ status: 401, message: "This passkey isn't registered with PRM" });

  const { origin, rpID } = relyingParty(event);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.id,
      publicKey: isoBase64URL.toBuffer(passkey.publicKey),
      counter: passkey.counter,
      transports: splitTransports(passkey.transports),
    },
  }).catch((error: Error) => {
    throw new HTTPError({ status: 401, message: error.message });
  });
  if (!verification.verified) throw new HTTPError({ status: 401, message: "Passkey could not be verified" });

  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, passkey.id));
  return passkey;
}
