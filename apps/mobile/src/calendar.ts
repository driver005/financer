/**
 * The calendar's logic, without any screen: date arithmetic on `YYYY-MM-DD` strings, expanding a
 * repeating event into the occurrences of a range, laying out overlapping events in a day column,
 * the month grid, and reading a quick-add sentence. Pure (no React Native), unit-tested.
 *
 * Dates are `YYYY-MM-DD` and times `HH:MM`, wall-clock with no zone: an event at 09:00 is at 09:00
 * wherever the phone is. Weeks start on Monday.
 */
import { MONTH_NAMES } from "./period";

export type Tone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";
export type RepeatKind = "none" | "daily" | "weekly" | "monthly" | "yearly";
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;
/** Hard stop for expanding a series, so a broken rule can never hang the screen. */
const MAX_STEPS = 5000;

// ---- dates ----

export function parseDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** Whole days since 1970-01-01. */
export function dayNumber(iso: string): number {
  const { y, m, d } = parseDate(iso);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function isoOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  return fromDayNumber(dayNumber(iso) + n);
}

export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (new Date(dayNumber(iso) * DAY_MS).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** Moves by whole months; a day that the target month lacks becomes its last day (31 Jan + 1 month = 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const { y, m, d } = parseDate(iso);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return isoOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(iso: string, n: number): string {
  return addMonths(iso, n * 12);
}

export function monthFirst(iso: string): string {
  const { y, m } = parseDate(iso);
  return isoOf(y, m, 1);
}

export function monthLast(iso: string): string {
  const { y, m } = parseDate(iso);
  return isoOf(y, m, daysInMonth(y, m));
}

/** The seven days of the week that holds `iso`, Monday first. */
export function weekOf(iso: string): string[] {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The weeks that show a month, Monday first: the days of the month plus the neighbours that fill the rows. */
export function monthGrid(iso: string): string[][] {
  const first = monthFirst(iso);
  const last = monthLast(iso);
  const start = startOfWeek(first);
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function monthTitle(iso: string): string {
  const { y, m } = parseDate(iso);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** `Tuesday, 3 November` (with the year when it is not `ref`'s year). */
export function longDay(iso: string, ref?: string): string {
  const { y, m, d } = parseDate(iso);
  const year = ref && parseDate(ref).y === y ? "" : ` ${y}`;
  return `${WEEKDAY_NAMES[weekdayIndex(iso)]}, ${d} ${MONTH_NAMES[m - 1]}${year}`;
}

/** `3 Nov` */
export function shortDay(iso: string): string {
  const { m, d } = parseDate(iso);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** What a week view calls its range: `2 - 8 Nov 2026`, `26 Oct - 1 Nov 2026`, `28 Dec 2026 - 3 Jan 2027`. */
export function weekTitle(iso: string): string {
  const days = weekOf(iso);
  const a = parseDate(days[0]);
  const b = parseDate(days[6]);
  const short = (m: number) => MONTH_NAMES[m - 1].slice(0, 3);
  if (a.y !== b.y) return `${a.d} ${short(a.m)} ${a.y} - ${b.d} ${short(b.m)} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${short(a.m)} - ${b.d} ${short(b.m)} ${b.y}`;
  return `${a.d} - ${b.d} ${short(b.m)} ${b.y}`;
}

// ---- times ----

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function timeOf(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** An absolute minute count since 1970 for a date and a time (a missing time is the start of the day). */
export function stamp(date: string, time: string | null | undefined): number {
  return dayNumber(date) * MINUTES_PER_DAY + (time ? minutesOf(time) : 0);
}

/** `9:30 - 10:30`, or `9:30 - 10:30 (until 5 Nov)` across days. */
export function timeRange(o: Pick<Occurrence, "allDay" | "startTime" | "endTime" | "startDate" | "endDate">): string {
  if (o.allDay || !o.startTime || !o.endTime) return "All day";
  const range = `${o.startTime} - ${o.endTime}`;
  return o.endDate === o.startDate ? range : `${range} (until ${shortDay(o.endDate)})`;
}

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

const NO_REPEAT: Repeat = { kind: "none", interval: 1, weekdays: [] };

/** Days the event lasts beyond its first day (0 for a single-day event). */
function spanDays(e: Pick<EventRule, "startDate" | "endDate">): number {
  return Math.max(0, daysBetween(e.startDate, e.endDate));
}

/**
 * The start dates of a series that fall within [from, to], in order. A series with a count counts
 * from its first start (deleted occurrences still count, as in other calendars).
 */
export function seriesStarts(rule: Pick<EventRule, "startDate" | "repeat" | "exceptions">, from: string, to: string): string[] {
  const r = rule.repeat ?? NO_REPEAT;
  const start = rule.startDate;
  if (r.kind === "none") return start >= from && start <= to ? [start] : [];
  const interval = Math.max(1, r.interval || 1);
  const last = r.until && r.until < to ? r.until : to;
  const skip = new Set(rule.exceptions);
  const out: string[] = [];
  let produced = 0; // occurrences generated so far, for the count
  const take = (iso: string): boolean => {
    // returns false when the series is over
    if (r.until && iso > r.until) return false;
    if (r.count && produced >= r.count) return false;
    produced++;
    if (iso >= from && iso <= last && !skip.has(iso)) out.push(iso);
    return iso <= last;
  };

  if (r.kind === "daily") {
    for (let i = 0, d = start; i < MAX_STEPS; i++, d = addDays(start, i * interval)) if (!take(d)) break;
  } else if (r.kind === "weekly") {
    const wanted = (r.weekdays.length ? r.weekdays : [WEEKDAY_CODES[weekdayIndex(start)]])
      .map((c) => WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number]))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const week0 = startOfWeek(start);
    outer: for (let w = 0; w < MAX_STEPS; w++) {
      const weekStart = addDays(week0, w * 7 * interval);
      if (weekStart > last) break;
      for (const wd of wanted) {
        const d = addDays(weekStart, wd);
        if (d < start) continue;
        if (!take(d)) break outer;
      }
    }
  } else if (r.kind === "monthly") {
    for (let i = 0; i < MAX_STEPS; i++) if (!take(addMonths(start, i * interval))) break;
  } else {
    for (let i = 0; i < MAX_STEPS; i++) if (!take(addYears(start, i * interval))) break;
  }
  return out;
}

/** The occurrences of an event that show between `from` and `to` (inclusive), with multi-day ones that started earlier. */
export function expand(rule: EventRule, from: string, to: string, tone: Tone, extra: { readOnly?: boolean; href?: string; source?: string } = {}): Occurrence[] {
  const span = spanDays(rule);
  // an occurrence that began up to `span` days before the range can still be running in it
  const starts = seriesStarts(rule, addDays(from, -span), to);
  const repeats = (rule.repeat?.kind ?? "none") !== "none";
  return starts
    .map((startDate): Occurrence => {
      const endDate = addDays(startDate, span);
      return {
        key: `${rule.id}:${startDate}`,
        eventId: rule.id,
        calendarId: rule.calendarId,
        title: rule.title,
        notes: rule.notes,
        location: rule.location,
        allDay: rule.allDay,
        startDate,
        startTime: rule.allDay ? null : rule.startTime,
        endDate,
        endTime: rule.allDay ? null : rule.endTime,
        tone,
        repeats,
        readOnly: extra.readOnly ?? false,
        href: extra.href,
        source: extra.source,
      };
    })
    .filter((o) => o.endDate >= from && o.startDate <= to);
}

/** Does the occurrence touch this day? */
export function onDay(o: Pick<Occurrence, "startDate" | "endDate">, date: string): boolean {
  return o.startDate <= date && o.endDate >= date;
}

/** Order for lists: all-day first, then by start. */
export function byStart(a: Occurrence, b: Occurrence): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return stamp(a.startDate, a.startTime) - stamp(b.startDate, b.startTime) || stamp(a.endDate, a.endTime) - stamp(b.endDate, b.endTime) || a.title.localeCompare(b.title);
}

/** Occurrences by day for a range, each list in display order. */
export function groupByDay(occurrences: Occurrence[], from: string, to: string): Map<string, Occurrence[]> {
  const days = new Map<string, Occurrence[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, []);
  for (const o of occurrences) {
    for (let d = o.startDate < from ? from : o.startDate; d <= o.endDate && d <= to; d = addDays(d, 1)) days.get(d)?.push(o);
  }
  for (const list of days.values()) list.sort(byStart);
  return days;
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
};

/** The shortest a block is drawn, so a 5-minute event can still be seen and tapped. */
export const MIN_BLOCK_MINUTES = 30;

/**
 * Timed events of one day as blocks in columns: events that overlap each other share the width of
 * the day. Events that continue past midnight are cut at the day's edges.
 */
export function dayBlocks(list: Occurrence[], date: string): Block[] {
  const timed = list
    .filter((o) => !o.allDay && onDay(o, date))
    .map((occurrence) => {
      const top = occurrence.startDate < date || !occurrence.startTime ? 0 : minutesOf(occurrence.startTime);
      const end = occurrence.endDate > date || !occurrence.endTime ? MINUTES_PER_DAY : minutesOf(occurrence.endTime);
      return { occurrence, top, bottom: Math.min(MINUTES_PER_DAY, Math.max(end, top + MIN_BLOCK_MINUTES)) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const blocks: Block[] = [];
  let cluster: { occurrence: Occurrence; top: number; bottom: number; column: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = cluster.reduce((n, b) => Math.max(n, b.column + 1), 0);
    for (const b of cluster) blocks.push({ ...b, columns });
    cluster = [];
    clusterEnd = -1;
  };
  for (const b of timed) {
    if (cluster.length > 0 && b.top >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.bottom > b.top).map((c) => c.column));
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ ...b, column });
    clusterEnd = Math.max(clusterEnd, b.bottom);
  }
  flush();
  return blocks;
}

// ---- reading a sentence ("Lunch with Anna tomorrow 12:30-13:30") ----

export type QuickEvent = { title: string; date: string; allDay: boolean; startTime: string | null; endTime: string | null };

const MONTH_WORDS: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.flatMap((name, i) => [[name.toLowerCase(), i + 1], [name.slice(0, 3).toLowerCase(), i + 1]]),
);

function clock(h: number, min: number, suffix?: string): string | null {
  let hour = h;
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Reads one sentence into an event. It understands `today`, `tomorrow`, a weekday (`friday`, `next
 * monday`), `5 dec`, `5.12.` / `5.12.2026`, `2026-12-05`, times as `9am`, `14:30`, `9-10`,
 * `9:30-11`, and `all day`. What is left is the title. Without a time the event is all day;
 * with a start only it lasts an hour.
 */
export function parseQuickAdd(text: string, today: string, fallbackDate: string = today): QuickEvent | null {
  let rest = ` ${text.trim()} `;
  if (!text.trim()) return null;
  const cut = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };

  let date: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = cut(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/))) date = isoOf(+m[1], +m[2], +m[3]);
  else if ((m = cut(/\s(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?(?=\s)/))) {
    const year = m[3] ? +m[3] : parseDate(today).y;
    date = isoOf(year, +m[2], +m[1]);
    if (!m[3] && date < today) date = isoOf(year + 1, +m[2], +m[1]);
  } else if ((m = cut(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?=\s)/i))) {
    const month = MONTH_WORDS[m[2].toLowerCase()];
    const year = parseDate(today).y;
    date = isoOf(year, month, +m[1]);
    if (date < today) date = isoOf(year + 1, month, +m[1]);
  } else if ((m = cut(/\s(today|tomorrow)(?=\s)/i))) date = addDays(today, m[1].toLowerCase() === "today" ? 0 : 1);
  else if ((m = cut(/\s(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s)/i))) {
    const target = WEEKDAY_NAMES.findIndex((n) => n.toLowerCase() === m![2].toLowerCase());
    // "friday" is the coming Friday (today, when it is Friday); "next friday" is never today
    let ahead = (target - weekdayIndex(today) + 7) % 7;
    if (m[1] && ahead === 0) ahead = 7;
    date = addDays(today, ahead);
  }

  const allDay = !!cut(/\s(all[\s-]?day)(?=\s)/i);
  let start: string | null = null;
  let end: string | null = null;
  if (!allDay) {
    const time = /\s(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?=\s)/i;
    if ((m = cut(time))) {
      start = clock(+m[1], m[2] ? +m[2] : 0, (m[3] ?? m[6])?.toLowerCase());
      end = clock(+m[4], m[5] ? +m[5] : 0, m[6]?.toLowerCase());
    } else if ((m = cut(/\s(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s)/i))) start = clock(+m[1], +m[2], m[3]?.toLowerCase());
    else if ((m = cut(/\s(?:at\s+)?(\d{1,2})\s*(am|pm)(?=\s)/i))) start = clock(+m[1], 0, m[2].toLowerCase());
    else if ((m = cut(/\sat\s+(\d{1,2})(?=\s)/i))) start = clock(+m[1], 0);
    if (start && !end) end = timeOf(minutesOf(start) + 60);
    if (start && end && minutesOf(end) <= minutesOf(start)) end = timeOf(Math.min(minutesOf(start) + 60, MINUTES_PER_DAY - 1));
  }

  const title = rest.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return { title, date: date ?? fallbackDate, allDay: allDay || !start, startTime: allDay || !start ? null : start, endTime: allDay || !start ? null : end };
}

/** A repeat in words: `Every day`, `Every 2 weeks on Mon, Thu`, `Every month`, `Every year until 5 Nov 2027`. */
export function repeatText(r: Repeat | undefined): string {
  if (!r || r.kind === "none") return "Does not repeat";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.kind];
  const every = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  const days = r.kind === "weekly" && r.weekdays.length ? ` on ${r.weekdays.map((c) => WEEKDAY_SHORT[WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number])] ?? c).join(", ")}` : "";
  const end = r.until ? `, until ${shortDay(r.until)} ${parseDate(r.until).y}` : r.count ? `, ${r.count} times` : "";
  return `${every}${days}${end}`;
}

/** A reminder in words: `At the start`, `10 minutes before`, `1 hour before`, `1 day before`. */
export function reminderText(minutes: number): string {
  if (minutes === 0) return "At the start";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? "" : "s"} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} before`;
  return `${minutes} minutes before`;
}
