/**
 * The calendar's logic, without any screen: date arithmetic on `YYYY-MM-DD` strings, expanding a
 * repeating event into the occurrences of a range, laying out overlapping events in a day column,
 * the month grid, and reading a quick-add sentence. The rules are in Rust (crates/logic,
 * calendar.rs); this file holds the shapes the screens use and the typed entries into it.
 *
 * Dates are `YYYY-MM-DD` and times `HH:MM`, wall-clock with no zone: an event at 09:00 is at 09:00
 * wherever the phone is. Weeks start on Monday.
 */
import { logic } from "../../../packages/wire/src/logic";
import { daysInMonth } from "./period";

export { daysInMonth };

export type Tone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";
export type RepeatKind = "none" | "daily" | "weekly" | "monthly" | "yearly";
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ---- dates ----

export const fromDayNumber = (n: number): string => logic("calendar.from_day_number", { n });
export const addDays = (iso: string, n: number): string => logic("calendar.add_days", { iso, n });
export const daysBetween = (a: string, b: string): number => logic("calendar.days_between", { a, b });
/** 0 = Monday ... 6 = Sunday. */
export const weekdayIndex = (iso: string): number => logic("calendar.weekday_index", { iso });
export const startOfWeek = (iso: string): string => logic("calendar.start_of_week", { iso });
/** Moves by whole months; a day that the target month lacks becomes its last day (31 Jan + 1 month = 28 Feb). */
export const addMonths = (iso: string, n: number): string => logic("calendar.add_months", { iso, n });
export const monthFirst = (iso: string): string => logic("calendar.month_first", { iso });
/** The seven days of the week that holds `iso`, Monday first. */
export const weekOf = (iso: string): string[] => logic("calendar.week_of", { iso });
/** The weeks that show a month, Monday first: the days of the month plus the neighbours that fill the rows. */
export const monthGrid = (iso: string): string[][] => logic("calendar.month_grid", { iso });
export const monthTitle = (iso: string): string => logic("calendar.month_title", { iso });
/** `Tuesday, 3 November` (with the year when it is not `ref`'s year). */
export const longDay = (iso: string, ref?: string): string => logic("calendar.long_day", { iso, reference: ref });
/** `3 Nov` */
export const shortDay = (iso: string): string => logic("calendar.short_day", { iso });
/** What a week view calls its range: `2 - 8 Nov 2026`, `26 Oct - 1 Nov 2026`, `28 Dec 2026 - 3 Jan 2027`. */
export const weekTitle = (iso: string): string => logic("calendar.week_title", { iso });

// ---- times ----

export const minutesOf = (time: string): number => logic("calendar.minutes_of", { time });
export const timeOf = (minutes: number): string => logic("calendar.time_of", { minutes });
/** An absolute minute count since 1970 for a date and a time (a missing time is the start of the day). */
export const stamp = (date: string, time: string | null | undefined): number => logic("calendar.stamp", { date, time: time ?? null });
/** `9:30 - 10:30`, or `9:30 - 10:30 (until 5 Nov)` across days. */
export const timeRange = (o: Pick<Occurrence, "allDay" | "startTime" | "endTime" | "startDate" | "endDate">): string => logic("calendar.time_range", { o });

// ---- events and occurrences ----

export type Repeat = { kind: RepeatKind; interval: number; weekdays: string[]; until?: string | null; count?: number | null };

/** What the server stores: an event with its repeat rule. */
export type EventRule = {
  id: number | string;
  calendarId: number | string;
  title: string;
  notes?: string | null;
  location?: string | null;
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  repeat: Repeat;
  exceptions: string[];
  reminders: number[];
};

/** One event as it shows on one run of the calendar: a single event, or one occurrence of a series. */
export type Occurrence = {
  /** Unique among the occurrences on screen. */
  key: string;
  eventId: number | string;
  calendarId: number | string;
  title: string;
  notes?: string | null;
  location?: string | null;
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  tone: Tone;
  /** Part of a repeating series. */
  repeats: boolean;
  /** Comes from another part of the app and cannot be edited here. */
  readOnly: boolean;
  /** Where tapping it leads, for events from the rest of the app. */
  href?: string;
  /** A small word for what it is ("Payday", "Meal"), for the detail view. */
  source?: string;
};

/**
 * The start dates of a series that fall within [from, to], in order. A series with a count counts
 * from its first start (deleted occurrences still count, as in other calendars).
 */
export const seriesStarts = (rule: Pick<EventRule, "startDate" | "repeat" | "exceptions">, from: string, to: string): string[] =>
  logic("calendar.series_starts", { rule, from, to });

/** The occurrences of an event that show between `from` and `to` (inclusive), with multi-day ones that started earlier. */
export const expand = (rule: EventRule, from: string, to: string, tone: Tone, extra: { readOnly?: boolean; href?: string; source?: string } = {}): Occurrence[] =>
  logic("calendar.expand", { rule, from, to, tone, extra });

/** Order for lists: all-day first, then by start. */
export const byStart = (a: Occurrence, b: Occurrence): number => logic("calendar.compare_by_start", { a, b });

/** Occurrences by day for a range, each list in display order. */
export function groupByDay(occurrences: Occurrence[], from: string, to: string): Map<string, Occurrence[]> {
  return new Map(logic<[string, Occurrence[]][]>("calendar.group_by_day", { occurrences, from, to }));
}

// ---- the day column of the week and day views ----

export type Block = {
  occurrence: Occurrence;
  /** Minutes from the start of the day. */
  top: number;
  bottom: number;
  /** Which of `columns` side-by-side columns it sits in. */
  column: number;
  columns: number;
  /**
   * How it is drawn: events that start at about the same time share the width side by side (`lane`
   * of `lanes`), later starts lie on top of earlier ones (`depth` of `depths`, each a little further right).
   */
  lane: number;
  lanes: number;
  depth: number;
  depths: number;
};

/**
 * Timed events of one day as blocks in columns: events that overlap each other share the width of
 * the day. Events that continue past midnight are cut at the day's edges.
 */
export const dayBlocks = (list: Occurrence[], date: string): Block[] => logic("calendar.day_blocks", { list, date });

// ---- reading a sentence ("Lunch with Anna tomorrow 12:30-13:30") ----

export type QuickEvent = { title: string; date: string; allDay: boolean; startTime: string | null; endTime: string | null };

/**
 * Reads one sentence into an event. It understands `today`, `tomorrow`, a weekday (`friday`, `next
 * monday`), `5 dec`, `5.12.` / `5.12.2026`, `2026-12-05`, times as `9am`, `14:30`, `9-10`,
 * `9:30-11`, and `all day`. What is left is the title. Without a time the event is all day;
 * with a start only it lasts an hour.
 */
export const parseQuickAdd = (text: string, today: string, fallbackDate: string = today): QuickEvent | null =>
  logic("calendar.parse_quick_add", { text, today, fallback_date: fallbackDate });

/** A repeat in words: `Every day`, `Every 2 weeks on Mon, Thu`, `Every month`, `Every year until 5 Nov 2027`. */
export const repeatText = (r: Repeat | undefined): string => logic("calendar.repeat_text", { r: r ?? null });

/** A reminder in words: `At the start`, `10 minutes before`, `1 hour before`, `1 day before`. */
export const reminderText = (minutes: number): string => logic("calendar.reminder_text", { minutes });
