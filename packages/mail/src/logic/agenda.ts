// The calendar as an agenda: events grouped by day, with the words for each.

import type { CalendarEvent, EventSource } from "../api/types";
import { dayLabel, daysBetween, dayOfMonth, localClock, shiftDay, weekdayShort, type Fmt } from "./format";

export type AgendaDay = {
  /** `2026-11-06` */
  key: string;
  label: string;
  weekday: string;
  day: string;
  today: boolean;
  events: CalendarEvent[];
};

const dateOf = (local: string) => local.slice(0, 10);

/**
 * Events by the day they start, soonest first. An event that began before the window (a trip) is
 * listed on the window's first day, so it is not lost.
 */
export function agendaDays(events: CalendarEvent[], o: { from: string; today: string; fmt?: Fmt }): AgendaDay[] {
  const f = o.fmt ?? {};
  const byDay = new Map<string, CalendarEvent[]>();
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  for (const e of sorted) {
    const key = dateOf(e.start) < o.from ? o.from : dateOf(e.start);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      label: dayLabel(key, o.today, f),
      weekday: weekdayShort(key, f),
      day: dayOfMonth(key),
      today: key === o.today,
      events: list,
    }));
}

/** "19:00", "19:00 – 21:00", "All day", "All day, until Sat 12 Dec". */
export function timeText(e: CalendarEvent, today: string, f: Fmt = {}): string {
  const startDay = dateOf(e.start);
  const endDay = e.end ? dateOf(e.end) : null;
  if (e.all_day) {
    return endDay && endDay !== startDay ? `All day, until ${dayLabel(endDay, today, f)}` : "All day";
  }
  const from = localClock(e.start, f);
  if (!e.end) return from;
  if (endDay === startDay) return `${from} – ${localClock(e.end, f)}`;
  return `${from} – ${dayLabel(endDay!, today, f)} ${localClock(e.end, f)}`;
}

export function sourceNote(source: EventSource): string {
  switch (source) {
    case "invite":
      return "From an invitation";
    case "text":
      return "Found in a message: check the time";
    case "manual":
      return "Added by you";
  }
}

/** How far ahead the agenda looks, in days. */
export const RANGES = [
  { value: "14", label: "2 weeks", days: 14 },
  { value: "31", label: "Month", days: 31 },
  { value: "92", label: "3 months", days: 92 },
] as const;

export type RangeValue = (typeof RANGES)[number]["value"];

export function rangeEnd(from: string, value: RangeValue): string {
  const days = RANGES.find((r) => r.value === value)?.days ?? 31;
  return shiftDay(from, days);
}

/** A time typed as `14:00`, `9`, `9:5` or `14.30` as `HH:MM`, or null. */
export function parseClock(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:[:.](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** A day typed as `2026-11-12` or `12.11.2026` (or `12.11.`, the current or next year) as `YYYY-MM-DD`, or null. */
export function parseDay(text: string, today: string): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(t);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (de) {
    [m, d] = [Number(de[2]), Number(de[1])];
    y = de[3] ? Number(de[3]) : Number(today.slice(0, 4));
    if (!de[3] && daysBetween(today, `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) < -60) y += 1;
  } else return null;
  const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== key ? null : key;
}
