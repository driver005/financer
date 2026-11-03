// Times and days for the screens. Everything takes the locale and zone as arguments so that the
// output is the same on every machine in tests; the screens pass the device's own.

export type Fmt = { locale?: string; timeZone?: string };

function parts(date: Date, f: Fmt, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(f.locale, { timeZone: f.timeZone, ...options }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** `2026-11-03`: the calendar day of an instant, in the zone. */
export function dayKey(ts: number, f: Fmt = {}): string {
  const p = parts(new Date(ts * 1000), { ...f, locale: "en-CA" }, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** `19:05` (or `7:05 PM`, as the locale writes it). */
export function clock(ts: number, f: Fmt = {}): string {
  return new Intl.DateTimeFormat(f.locale, { timeZone: f.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(ts * 1000));
}

/** A day key moved by whole days. */
export function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both day keys). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const UTC: Fmt = { timeZone: "UTC" };

/** `Fri`: the short weekday of a day key. */
export function weekdayShort(key: string, f: Fmt = {}): string {
  return parts(new Date(`${key}T00:00:00Z`), { ...f, ...UTC }, { weekday: "short" }).weekday;
}

/** `6`: the day of the month. */
export function dayOfMonth(key: string): string {
  return String(Number(key.slice(8, 10)));
}

/** `Fri 6 Nov`, with the year when it is not this one. */
export function dayText(key: string, todayKey: string, f: Fmt = {}): string {
  const withYear = key.slice(0, 4) !== todayKey.slice(0, 4);
  const p = parts(new Date(`${key}T00:00:00Z`), { ...f, ...UTC }, { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return [p.weekday, p.day, p.month, withYear ? p.year : undefined].filter(Boolean).join(" ");
}

/** The words for a day in a chat or an agenda: Today, Tomorrow, Yesterday, or the date. */
export function dayLabel(key: string, todayKey: string, f: Fmt = {}): string {
  if (key === todayKey) return "Today";
  if (key === shiftDay(todayKey, 1)) return "Tomorrow";
  if (key === shiftDay(todayKey, -1)) return "Yesterday";
  return dayText(key, todayKey, f);
}

/** For a conversation list: the time today, "Yesterday", the weekday this week, else the date. */
export function listTime(ts: number, nowTs: number, f: Fmt = {}): string {
  const key = dayKey(ts, f);
  const today = dayKey(nowTs, f);
  if (key === today) return clock(ts, f);
  if (key === shiftDay(today, -1)) return "Yesterday";
  const age = daysBetween(key, today);
  if (age > 0 && age < 7) return weekdayShort(key, f);
  const p = parts(new Date(`${key}T00:00:00Z`), { ...f, ...UTC }, { day: "numeric", month: "short", ...(key.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  return [p.day, p.month, p.year].filter(Boolean).join(" ");
}

/** "just now", "5 min ago", "2 h ago", "3 days ago": how long ago something was. */
export function ago(ts: number, nowTs: number): string {
  const s = Math.max(0, nowTs - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** `19:00` from `2026-11-06T19:00`, written as the locale does. */
export function localClock(local: string, f: Fmt = {}): string {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  return new Intl.DateTimeFormat(f.locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}
