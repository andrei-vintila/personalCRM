/**
 * Duplicate detection. Identities are already unique (two contacts can never share
 * an email or LinkedIn URL), so duplicates show up as near-misses: the same name
 * from different sources, nicknames, the same phone in local vs international
 * format, or the same email username at a different domain.
 *
 * Pure functions over an in-memory snapshot; candidate pairs come from small
 * "blocks" (shared keys) so this stays fast for tens of thousands of contacts.
 */

export interface DedupeContact {
  id: string;
  name: string;
  company: string | null;
  identities: { kind: string; value: string }[];
}

export interface DuplicatePair {
  ids: [string, string];
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

const MIN_SCORE = 0.5;
/** Very common keys (e.g. first name "john") would explode into many weak pairs. */
const MAX_BLOCK = 60;
const MAX_EXACT_BLOCK = 500;

const NICKNAMES: Record<string, string> = {
  bob: "robert", bobby: "robert", rob: "robert", robbie: "robert", bert: "robert",
  bill: "william", billy: "william", will: "william", liam: "william",
  mike: "michael", mikey: "michael", mick: "michael",
  jim: "james", jimmy: "james", jamie: "james",
  dave: "david", davey: "david",
  dan: "daniel", danny: "daniel",
  tom: "thomas", tommy: "thomas",
  tony: "anthony",
  alex: "alexander", sasha: "alexander", xander: "alexander",
  chris: "christopher", kit: "christopher",
  kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "katherine", catherine: "katherine", kat: "katherine",
  liz: "elizabeth", lizzie: "elizabeth", beth: "elizabeth", betty: "elizabeth", eliza: "elizabeth",
  sam: "samuel", sammy: "samuel",
  ben: "benjamin", benji: "benjamin",
  nick: "nicholas", nicky: "nicholas",
  matt: "matthew", matty: "matthew",
  steve: "stephen", steven: "stephen",
  joe: "joseph", joey: "joseph",
  andy: "andrew", drew: "andrew",
  jen: "jennifer", jenny: "jennifer",
  pat: "patrick", paddy: "patrick",
  rick: "richard", rich: "richard", dick: "richard", richie: "richard",
  ed: "edward", eddie: "edward", ted: "edward", ned: "edward",
  greg: "gregory",
  jon: "jonathan", johnny: "john", jack: "john",
  josh: "joshua",
  nate: "nathan", nathaniel: "nathan",
  pete: "peter",
  phil: "philip", phillip: "philip",
  sue: "susan", susie: "susan",
  vicky: "victoria", tori: "victoria",
  zach: "zachary", zack: "zachary",
  abby: "abigail",
  meg: "margaret", maggie: "margaret", peggy: "margaret",
  fred: "frederick", freddie: "frederick",
  larry: "lawrence",
  tim: "timothy", timmy: "timothy",
  ken: "kenneth", kenny: "kenneth",
  ron: "ronald", ronnie: "ronald",
  don: "donald", donnie: "donald",
  gabe: "gabriel", gabi: "gabriela",
  manny: "manuel",
  vlad: "vladimir",
  misha: "mikhail",
  dima: "dmitry",
};

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "jr", "sr", "ii", "iii", "iv", "phd", "md", "mba", "esq"]);

const GENERIC_LOCAL_PARTS = new Set(["info", "hello", "contact", "admin", "office", "mail", "me", "hi", "team", "support", "sales", "jobs"]);

interface Prepared {
  c: DedupeContact;
  full: string;
  tokens: string[];
  first: string;
  last: string;
  canonFirst: string;
  company: string;
  phones: string[];
  emailLocals: string[];
}

export function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
    .join(" ");
}

function prepare(c: DedupeContact): Prepared {
  const full = normalizeName(c.name);
  const tokens = full.split(" ").filter(Boolean);
  const first = tokens[0] ?? "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : "";
  return {
    c,
    full,
    tokens,
    first,
    last,
    canonFirst: NICKNAMES[first] ?? first,
    company: normalizeName(c.company ?? ""),
    // Last 9 digits survive "+40 712…" vs "0712…" vs "(712) …" formatting differences.
    phones: unique(
      c.identities
        .filter((i) => i.kind === "phone")
        .map((i) => i.value.replace(/\D/g, ""))
        .filter((d) => d.length >= 9)
        .map((d) => d.slice(-9)),
    ),
    emailLocals: unique(
      c.identities
        .filter((i) => i.kind === "email")
        .map((i) => i.value.split("@")[0].replace(/\+.*$/, ""))
        .filter((l) => l.length >= 5 && !GENERIC_LOCAL_PARTS.has(l)),
    ),
  };
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function scorePair(a: Prepared, b: Prepared): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const bump = (value: number, reason: string) => {
    if (value > score) score = value;
    reasons.push(reason);
  };

  const sharedPhone = a.phones.some((p) => b.phones.includes(p));
  if (sharedPhone) bump(0.9, "Same phone number in a different format");

  if (a.full && a.full === b.full) bump(a.tokens.length > 1 ? 0.85 : 0.5, "Same name");
  else if (a.last && a.last === b.last && a.canonFirst === b.canonFirst) {
    bump(0.8, a.first === b.first ? "Same first and last name" : `Same last name, ${a.first} / ${b.first}`);
  } else if (a.last && a.last === b.last && (isInitialOf(a.first, b.first) || isInitialOf(b.first, a.first))) {
    bump(0.6, "Same last name and initial");
  } else if (a.tokens.length === 1 && a.first === b.first && b.tokens.length > 1) {
    bump(0.5, "First name only");
  } else if (b.tokens.length === 1 && b.first === a.first && a.tokens.length > 1) {
    bump(0.5, "First name only");
  } else if (a.full.length >= 8 && b.full.length >= 8) {
    const limit = Math.min(a.full.length, b.full.length) >= 14 ? 2 : 1;
    if (editDistanceWithin(a.full, b.full, limit)) bump(0.6, "Very similar name");
  }

  const sharedLocal = a.emailLocals.find((l) => b.emailLocals.includes(l));
  if (sharedLocal) bump(0.7, `Same email username (${sharedLocal}@…)`);

  if (score > 0 && a.company && a.company === b.company) {
    score = Math.min(1, score + 0.1);
    reasons.push("Same company");
  }
  return { score, reasons };
}

function isInitialOf(maybeInitial: string, name: string) {
  return maybeInitial.length === 1 && name.length > 1 && name.startsWith(maybeInitial);
}

/** Bounded Levenshtein: true when distance ≤ limit (early exit). */
function editDistanceWithin(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return false;
    prev = cur;
  }
  return prev[b.length] <= limit;
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function findDuplicatePairs(contacts: DedupeContact[], dismissed: Set<string> = new Set()): DuplicatePair[] {
  const prepared = contacts.map(prepare);
  const blocks = new Map<string, Prepared[]>();
  const add = (key: string, p: Prepared) => {
    if (!key) return;
    const list = blocks.get(key);
    if (list) list.push(p);
    else blocks.set(key, [p]);
  };

  for (const p of prepared) {
    add(`full:${p.full}`, p);
    if (p.last) add(`last:${p.last}`, p);
    if (p.first) add(`first:${p.canonFirst}`, p);
    // Typos: names that start alike and have similar length.
    if (p.full.length >= 8) add(`pre:${p.full.slice(0, 3)}:${Math.floor(p.full.length / 4)}`, p);
    for (const phone of p.phones) add(`phone:${phone}`, p);
    for (const local of p.emailLocals) add(`local:${local}`, p);
  }

  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];
  for (const [key, members] of blocks) {
    if (members.length < 2) continue;
    const exactKey = key.startsWith("full:") || key.startsWith("phone:") || key.startsWith("local:");
    if (members.length > (exactKey ? MAX_EXACT_BLOCK : MAX_BLOCK)) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (a.c.id === b.c.id) continue;
        const k = pairKey(a.c.id, b.c.id);
        if (seen.has(k) || dismissed.has(k)) continue;
        seen.add(k);
        const { score, reasons } = scorePair(a, b);
        if (score < MIN_SCORE) continue;
        pairs.push({
          ids: [a.c.id, b.c.id],
          score: Math.round(score * 100) / 100,
          confidence: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : "low",
          reasons,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}
