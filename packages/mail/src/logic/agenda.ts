// The calendar as an agenda: events grouped by day, with the words for each. The rules are in Rust
// (crates/logic, mail_format.rs).

import { logic } from "../../../wire/src/logic";
import type { CalendarEvent, EventSource } from "../api/types";
import type { Fmt } from "./format";
import { packOf } from "./format";

export type AgendaDay = {
  /** `2026-11-06` */
  key: string;
  label: string;
  weekday: string;
  day: string;
  today: boolean;
  events: CalendarEvent[];
};

/**
 * Events by the day they start, soonest first. An event that began before the window (a trip) is
 * listed on the window's first day, so it is not lost.
 */
export const agendaDays = (events: CalendarEvent[], o: { from: string; today: string; fmt?: Fmt }): AgendaDay[] =>
  logic("mail_format.agenda_days", { events, from: o.from, today: o.today, pack: packOf(o.fmt ?? {}) });

/** "19:00", "19:00 – 21:00", "All day", "All day, until Sat 12 Dec". */
export const timeText = (e: CalendarEvent, today: string, f: Fmt = {}): string => logic("mail_format.time_text", { e, today, pack: packOf(f) });

export const sourceNote = (source: EventSource): string => logic("mail_format.source_note", { source });

/** How far ahead the agenda looks, in days. */
export const RANGES = [
  { value: "14", label: "2 weeks", days: 14 },
  { value: "31", label: "Month", days: 31 },
  { value: "92", label: "3 months", days: 92 },
] as const;

export type RangeValue = (typeof RANGES)[number]["value"];

export const rangeEnd = (from: string, value: RangeValue): string => logic("mail_format.range_end", { from, value });

/** A time typed as `14:00`, `9`, `9:5` or `14.30` as `HH:MM`, or null. */
export const parseClock = (text: string): string | null => logic("mail_format.parse_clock", { text });

/** A day typed as `2026-11-12` or `12.11.2026` (or `12.11.`, the current or next year) as `YYYY-MM-DD`, or null. */
export const parseDay = (text: string, today: string): string | null => logic("mail_format.parse_day", { text, today });
