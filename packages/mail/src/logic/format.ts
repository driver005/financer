// Times and days for the screens. The rules are in Rust (crates/logic, mail_format.rs): the time zone
// arithmetic uses Rust's own copy of the IANA database, so it does not depend on the device.
//
// What only the device knows is how its language writes things: the short weekday and month names, how a
// clock is laid out (24 hours or AM/PM) and which digits it uses. That is asked of `Intl` here, once per
// language, and handed to Rust as a small "pack". Everything takes the locale and zone as arguments so that
// the output is the same on every machine in tests; the screens pass the device's own.

import { logic } from "../../../wire/src/logic";

export type Fmt = { locale?: string; timeZone?: string };

type Pack = {
  weekdays: string[];
  months: string[];
  clock: { template: string; hour_cycle: string; am: string; pm: string };
  digits: string;
};

function parts(date: Date, locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).formatToParts(date);
}

const part = (list: Intl.DateTimeFormatPart[], type: string): string => list.find((p) => p.type === type)?.value ?? "";

function buildPack(locale: string | undefined): Pack {
  // 2 November 2026 is a Monday
  const weekdays = Array.from({ length: 7 }, (_, i) => part(parts(new Date(Date.UTC(2026, 10, 2 + i)), locale, { weekday: "short" }), "weekday"));
  const months = Array.from({ length: 12 }, (_, m) => part(parts(new Date(Date.UTC(2026, m, 15)), locale, { day: "numeric", month: "short" }), "month"));
  const time = { hour: "2-digit", minute: "2-digit" } as const;
  const morning = parts(new Date(Date.UTC(2000, 0, 1, 7, 5)), locale, time);
  const evening = parts(new Date(Date.UTC(2000, 0, 1, 19, 5)), locale, time);
  const template = morning.map((p) => (p.type === "hour" ? "{h}" : p.type === "minute" ? "{m}" : p.type === "dayPeriod" ? "{p}" : p.value)).join("").replace(/\u202f/g, " "); // format() itself writes a plain space for U+202F
  const cycle = new Intl.DateTimeFormat(locale, { ...time, timeZone: "UTC" }).resolvedOptions().hourCycle ?? (template.includes("{p}") ? "h12" : "h23");
  const digits = Array.from({ length: 10 }, (_, i) => new Intl.NumberFormat(locale, { useGrouping: false }).format(i)).join("");
  return { weekdays, months, clock: { template, hour_cycle: cycle, am: part(morning, "dayPeriod"), pm: part(evening, "dayPeriod") }, digits };
}

const packs = new Map<string, Pack>();

function packFor(locale: string | undefined): Pack {
  const key = locale ?? "";
  let pack = packs.get(key);
  if (!pack) {
    pack = buildPack(locale);
    packs.set(key, pack);
  }
  return pack;
}

export const zoneOf = (f: Fmt): string => f.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

/** The call with the zone and the language's pack added. */
const withFmt = <T>(name: string, args: Record<string, unknown>, f: Fmt, what: "zone" | "pack" | "both"): T =>
  logic<T>(name, {
    ...args,
    ...(what !== "pack" ? { zone: zoneOf(f) } : {}),
    ...(what !== "zone" ? { pack: packFor(f.locale) } : {}),
  });

/** `2026-11-03`: the calendar day of an instant, in the zone. */
export const dayKey = (ts: number, f: Fmt = {}): string => withFmt("mail_format.day_key", { ts }, f, "zone");

/** `19:05` (or `7:05 PM`, as the language writes it). */
export const clock = (ts: number, f: Fmt = {}): string => withFmt("mail_format.clock", { ts }, f, "both");

/** A day key moved by whole days. */
export const shiftDay = (key: string, days: number): string => logic("mail_format.shift_day", { key, days });

/** Whole days from `a` to `b` (both day keys). */
export const daysBetween = (a: string, b: string): number => logic("mail_format.days_between", { a, b });

/** `Fri`: the short weekday of a day key. */
export const weekdayShort = (key: string, f: Fmt = {}): string => withFmt("mail_format.weekday_short", { key }, f, "pack");

/** `6`: the day of the month. */
export const dayOfMonth = (key: string): string => logic("mail_format.day_of_month", { key });

/** `Fri 6 Nov`, with the year when it is not this one. */
export const dayText = (key: string, todayKey: string, f: Fmt = {}): string => withFmt("mail_format.day_text", { key, today_key: todayKey }, f, "pack");

/** The words for a day in a chat or an agenda: Today, Tomorrow, Yesterday, or the date. */
export const dayLabel = (key: string, todayKey: string, f: Fmt = {}): string => withFmt("mail_format.day_label", { key, today_key: todayKey }, f, "pack");

/** For a conversation list: the time today, "Yesterday", the weekday this week, else the date. */
export const listTime = (ts: number, nowTs: number, f: Fmt = {}): string => withFmt("mail_format.list_time", { ts, now_ts: nowTs }, f, "both");

/** The heading a chat list groups under: Today, Yesterday, This week or Earlier. */
export const listGroup = (ts: number, nowTs: number, f: Fmt = {}): string => withFmt("mail_format.list_group", { ts, now_ts: nowTs }, f, "zone");

/** "just now", "5 min ago", "2 h ago", "3 days ago": how long ago something was. */
export const ago = (ts: number, nowTs: number): string => logic("mail_format.ago", { ts, now_ts: nowTs });

/** `19:00` from `2026-11-06T19:00`, written as the language does. */
export const localClock = (local: string, f: Fmt = {}): string => withFmt("mail_format.local_clock", { local }, f, "pack");

/** The language's pack, for the calls that only need the words. */
export const packOf = (f: Fmt): Pack => packFor(f.locale);
