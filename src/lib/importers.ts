import { normalizeBirthday } from "../../server/utils/birthdays";
import { csvToRecords } from "../../server/utils/csv";
import type { ImportContact } from "./api";

export type ImportFormat = "linkedin" | "google" | "generic";

export const importFormats: { id: ImportFormat; label: string; help: string }[] = [
  {
    id: "linkedin",
    label: "LinkedIn connections",
    help: "LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. Upload Connections.csv.",
  },
  {
    id: "google",
    label: "Google Contacts",
    help: "contacts.google.com → Export → Google CSV.",
  },
  {
    id: "generic",
    label: "Any CSV",
    help: "Columns named like name, email, phone, company, title, location, linkedin, birthday, notes.",
  },
];

export function parseImport(format: ImportFormat, text: string): ImportContact[] {
  const rows = (() => {
    switch (format) {
      case "linkedin":
        return csvToRecords(text, (h) => h.includes("First Name") && h.includes("Last Name")).map(fromLinkedIn);
      case "google":
        return csvToRecords(text, (h) => h.includes("First Name") || h.includes("Given Name") || h.includes("Name")).map(
          fromGoogle,
        );
      case "generic":
        return csvToRecords(text, (h) => h.some((c) => /name|e-?mail/i.test(c))).map(fromGeneric);
    }
  })();
  return rows.filter((r): r is ImportContact => Boolean(r?.name));
}

function fromLinkedIn(r: Record<string, string>): ImportContact | null {
  const name = join(r["First Name"], r["Last Name"]);
  if (!name) return null;
  return {
    name,
    company: r["Company"] || null,
    title: r["Position"] || null,
    identities: [
      ...(r["URL"] ? [{ kind: "linkedin" as const, value: r["URL"] }] : []),
      ...(r["Email Address"] ? [{ kind: "email" as const, value: r["Email Address"] }] : []),
    ],
  };
}

function fromGoogle(r: Record<string, string>): ImportContact | null {
  const name =
    join(r["First Name"] ?? r["Given Name"], r["Middle Name"] ?? r["Additional Name"], r["Last Name"] ?? r["Family Name"]) ||
    r["Name"] ||
    r["Nickname"] ||
    r["Organization Name"] ||
    r["Organization 1 - Name"];
  if (!name) return null;

  const multi = (pattern: RegExp) =>
    Object.entries(r)
      .filter(([key, value]) => pattern.test(key) && value)
      .flatMap(([, value]) => value.split(":::").map((v) => v.trim()))
      .filter(Boolean);

  return {
    name,
    company: r["Organization Name"] || r["Organization 1 - Name"] || null,
    title: r["Organization Title"] || r["Organization 1 - Title"] || null,
    about: r["Notes"] || null,
    birthday: normalizeBirthday(r["Birthday"]),
    identities: [
      ...multi(/^E-mail \d+ - Value$/).map((value) => ({ kind: "email" as const, value })),
      ...multi(/^Phone \d+ - Value$/).map((value) => ({ kind: "phone" as const, value })),
      ...multi(/^Website \d+ - Value$/).map((value) => ({
        kind: /linkedin\.com\/in\//i.test(value) ? ("linkedin" as const) : ("url" as const),
        value,
      })),
    ],
  };
}

function fromGeneric(r: Record<string, string>): ImportContact | null {
  const get = (...names: RegExp[]) => {
    for (const [key, value] of Object.entries(r)) if (value && names.some((n) => n.test(key))) return value;
    return null;
  };
  const name =
    get(/^(full ?)?name$/i, /^display ?name$/i) || join(get(/^first ?name$/i, /^given/i) ?? "", get(/^last ?name$/i, /^family|surname/i) ?? "");
  if (!name) return null;
  const email = get(/e-?mail/i);
  const phone = get(/phone|mobile|tel/i);
  const linkedin = get(/linkedin/i);
  return {
    name,
    company: get(/^company|organi[sz]ation/i),
    title: get(/^(job ?)?title|position|role/i),
    location: get(/location|city/i),
    about: get(/notes?|about|bio/i),
    birthday: normalizeBirthday(get(/birthday|birth ?date|date of birth|dob/i)),
    identities: [
      ...(email ? [{ kind: "email" as const, value: email }] : []),
      ...(phone ? [{ kind: "phone" as const, value: phone }] : []),
      ...(linkedin ? [{ kind: "linkedin" as const, value: linkedin }] : []),
    ],
  };
}

function join(...parts: (string | undefined | null)[]) {
  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
}
