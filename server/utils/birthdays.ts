/**
 * Birthdays are stored as YYYY-MM-DD, or --MM-DD when the year is unknown. They are
 * calendar dates, not instants, so everything here works on UTC midnights.
 * Shared by the server and the web client (no server-only imports).
 */

const DAY_MS = 86_400_000;
export const BIRTHDAY_PATTERN = /^(\d{4}|-)-(\d{2})-(\d{2})$/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface ParsedBirthday {
  year: number | null;
  /** 1-12 */
  month: number;
  day: number;
}

export function parseBirthday(birthday: string): ParsedBirthday | null {
  const m = birthday.match(BIRTHDAY_PATTERN);
  if (!m) return null;
  const year = m[1] === "-" ? null : Number(m[1]);
  const [month, day] = [Number(m[2]), Number(m[3])];
  return isValidDate(year ?? 2000, month, day) ? { year, month, day } : null;
}

function isValidDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

function format(year: number | null, month: number, day: number) {
  return `${year ?? "-"}-${pad(month)}-${pad(day)}`;
}

/**
 * Turns the birthday formats found in exports into YYYY-MM-DD / --MM-DD, or null.
 * Accepts ISO dates (with or without a time), --MM-DD, YYYYMMDD, DD.MM.YYYY,
 * "April 21, 1990", "21 Apr 1990", "Apr 21", and slashed dates when the order is
 * unambiguous (one part above 12 or a leading year). 04/05/1990 is dropped rather than guessed.
 */
export function normalizeBirthday(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;
  const ok = (year: number | null, month: number, day: number) => {
    if (year === 0 || year === 1604) year = null;
    if (year !== null && (year < 1900 || year > 2100)) return null;
    return isValidDate(year ?? 2000, month, day) ? format(year, month, day) : null;
  };

  let m: RegExpMatchArray | null;
  // 1990-04-21, 1990-04-21T00:00:00Z, 1990/04/21, 1990.04.21
  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/))) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
  // --04-21 (Google), 0000-04-21 / 1604-04-21 (Apple's placeholder years for "no year")
  if ((m = v.match(/^--(\d{2})-?(\d{2})$/))) return ok(null, Number(m[1]), Number(m[2]));
  if ((m = v.match(/^(\d{4})(\d{2})(\d{2})$/))) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
  // 21.04.1990 is always day-first.
  if ((m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return ok(Number(m[3]), Number(m[2]), Number(m[1]));
  // 04/21/1990 or 21/04/1990: only when one side can't be a month.
  if ((m = v.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/))) {
    const [a, b, year] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
    if (a > 12 && b <= 12) return ok(year, b, a);
    if (b > 12 && a <= 12) return ok(year, a, b);
    return null;
  }
  // April 21, 1990 / Apr 21
  if ((m = v.match(/^([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/))) {
    const month = monthIndex(m[1]);
    return month ? ok(m[3] ? Number(m[3]) : null, month, Number(m[2])) : null;
  }
  // 21 April 1990 / 21 Apr
  if ((m = v.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,})\.?,?(?: (\d{4}))?$/))) {
    const month = monthIndex(m[2]);
    return month ? ok(m[3] ? Number(m[3]) : null, month, Number(m[1])) : null;
  }
  return null;
}

function monthIndex(name: string) {
  const i = MONTHS.indexOf(name.slice(0, 3));
  return i === -1 ? null : i + 1;
}

/** UTC midnight of the birthday in `year`; Feb 29 falls on Feb 28 in other years. */
function occurrenceIn(b: ParsedBirthday, year: number) {
  const day = b.month === 2 && b.day === 29 && !isValidDate(year, 2, 29) ? 28 : b.day;
  return Date.UTC(year, b.month - 1, day);
}

function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Days from today until the next birthday (0 = today), or null if it can't be parsed. */
export function daysUntilBirthday(birthday: string, today: Date): number | null {
  const b = parseBirthday(birthday);
  if (!b) return null;
  const start = utcMidnight(today);
  let next = occurrenceIn(b, today.getUTCFullYear());
  if (next < start) next = occurrenceIn(b, today.getUTCFullYear() + 1);
  return Math.round((next - start) / DAY_MS);
}

export interface BirthdayOccurrence {
  /** YYYY-MM-DD of this year's celebration */
  date: string;
  /** Age turned on that day, when the birth year is known */
  age: number | null;
}

/**
 * Every celebration from `from` up to and including the next one on or after `today`.
 * Occurrences before the birth year (or the birth day itself) are left out.
 */
export function birthdayOccurrences(birthday: string, opts: { from: Date; today: Date }): BirthdayOccurrence[] {
  const b = parseBirthday(birthday);
  if (!b) return [];
  const from = utcMidnight(opts.from);
  const today = utcMidnight(opts.today);
  const out: BirthdayOccurrence[] = [];
  for (let year = opts.from.getUTCFullYear(); year <= opts.today.getUTCFullYear() + 1; year++) {
    if (b.year !== null && year <= b.year) continue;
    const at = occurrenceIn(b, year);
    if (at < from) continue;
    const d = new Date(at);
    out.push({ date: format(year, d.getUTCMonth() + 1, d.getUTCDate()), age: b.year === null ? null : year - b.year });
    if (at >= today) break;
  }
  return out;
}
