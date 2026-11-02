/**
 * AES-GCM encryption for OAuth tokens at rest. The key is derived from a server
 * secret (the Google client secret), so a leaked database or backup alone does
 * not expose usable tokens.
 */
async function deriveKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`personal-crm-tokens:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(secret), new TextEncoder().encode(plaintext));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(data))}`;
}

export async function decryptSecret(sealed: string, secret: string): Promise<string> {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await deriveKey(secret), fromBase64(data));
  return new TextDecoder().decode(plain);
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
