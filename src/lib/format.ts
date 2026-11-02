const DAY_MS = 86_400_000;

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function relativeTime(iso: string | number | null | undefined, now = Date.now()) {
  if (iso === null || iso === undefined) return "never";
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const diff = t - now;
  const days = Math.round(diff / DAY_MS);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(diff) < 60 * 60 * 1000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (Math.abs(diff) < DAY_MS) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
  return rtf.format(Math.round(days / 365), "year");
}

export function formatDate(iso: string, withTime = false) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function formatBirthday(birthday: string) {
  const [, year, month, day] = birthday.match(/^(\d{4}|-)-(\d{2})-(\d{2})$/) ?? [];
  if (!month) return birthday;
  const date = new Date(Date.UTC(2000, Number(month) - 1, Number(day)));
  const label = date.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
  return year && year !== "-" ? `${label}, ${year}` : label;
}

export const cadenceOptions = [
  { value: null, label: "Don't track" },
  { value: 7, label: "Every week" },
  { value: 14, label: "Every 2 weeks" },
  { value: 30, label: "Every month" },
  { value: 60, label: "Every 2 months" },
  { value: 90, label: "Every quarter" },
  { value: 180, label: "Every 6 months" },
  { value: 365, label: "Every year" },
] as const;

export function cadenceLabel(days: number | null) {
  return cadenceOptions.find((o) => o.value === days)?.label ?? (days ? `Every ${days} days` : "Don't track");
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
