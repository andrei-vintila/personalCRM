import type { IdentityKind } from "../db/schema";

/** Canonical form used for the unique (kind, value) index and de-duplication. */
export function normalizeIdentity(kind: IdentityKind, raw: string): string {
  const value = raw.trim();
  switch (kind) {
    case "email":
      return value.toLowerCase();
    case "phone": {
      const plus = value.startsWith("+") ? "+" : "";
      return plus + value.replace(/\D/g, "");
    }
    case "linkedin": {
      const match = value.match(/linkedin\.com\/in\/([^/?#]+)/i);
      return (match ? match[1] : value.replace(/^@/, "")).toLowerCase();
    }
    case "twitter": {
      const match = value.match(/(?:twitter|x)\.com\/([^/?#]+)/i);
      return (match ? match[1] : value.replace(/^@/, "")).toLowerCase();
    }
    case "url":
      return value.replace(/\/+$/, "").toLowerCase();
  }
}
