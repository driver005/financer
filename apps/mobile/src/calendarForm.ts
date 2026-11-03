/**
 * The event editor's draft: what the form edits, how it starts (a new event on a day or at a time,
 * or an existing occurrence), whether it is valid, and the request it turns into. Pure, unit-tested.
 */
import type { CalendarEvent, CalendarEventInput } from "./api/client";
import {
  WEEKDAY_CODES,
  addDays,
  daysBetween,
  fromDayNumber,
  minutesOf,
  stamp,
  timeOf,
  weekdayIndex,
  type EventRule,
  type Occurrence,
  type Repeat,
  type RepeatKind,
} from "./calendar";

export type Draft = {
  /** Set when editing an existing event. */
  id: number | null;
  calendarId: number | null;
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: Repeat;
  exceptions: string[];
  reminders: number[];
};

/** Reminder choices, in minutes before the start. */
export const REMINDER_CHOICES = [0, 10, 30, 60, 1440, 10_080] as const;

/** Default when a new event is made without a time (a tap on the add button): the next whole hour. */
export function nextHour(now: Date): string {
  return timeOf(Math.min(23 * 60, (now.getHours() + 1) * 60));
}

/** A new event on a day, at a time when given, one hour long. */
export function newDraft(date: string, calendarId: number | null, time?: string | null): Draft {
  const start = time ?? "09:00";
  const startMinutes = minutesOf(start);
  const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 59);
  return {
    id: null,
    calendarId,
    title: "",
    notes: "",
    location: "",
    allDay: false,
    startDate: date,
    startTime: start,
    endDate: date,
    endTime: timeOf(endMinutes),
    repeat: { kind: "none", interval: 1, weekdays: [] },
    exceptions: [],
    reminders: [10],
  };
}

/** The rule the server stores for an event it sent. */
export function ruleFromDto(e: CalendarEvent): EventRule {
  return {
    id: e.id,
    calendarId: e.calendar_id,
    title: e.title,
    notes: e.notes,
    location: e.location,
    allDay: e.all_day,
    startDate: e.start_date,
    startTime: e.start_time ?? null,
    endDate: e.end_date,
    endTime: e.end_time ?? null,
    repeat: { kind: e.repeat.kind as RepeatKind, interval: e.repeat.interval, weekdays: e.repeat.weekdays, until: e.repeat.until ?? null, count: e.repeat.count ?? null },
    exceptions: e.exceptions,
    reminders: e.reminders,
  };
}

/** The draft for editing an event: its first occurrence's dates (editing changes the whole series). */
export function draftFromRule(rule: EventRule): Draft {
  return {
    id: typeof rule.id === "number" ? rule.id : Number(rule.id),
    calendarId: typeof rule.calendarId === "number" ? rule.calendarId : Number(rule.calendarId),
    title: rule.title,
    notes: rule.notes ?? "",
    location: rule.location ?? "",
    allDay: rule.allDay,
    startDate: rule.startDate,
    startTime: rule.startTime ?? "09:00",
    endDate: rule.endDate,
    endTime: rule.endTime ?? timeOf(minutesOf(rule.startTime ?? "09:00") + 60),
    repeat: { ...rule.repeat, weekdays: [...rule.repeat.weekdays] },
    exceptions: [...rule.exceptions],
    reminders: [...rule.reminders],
  };
}

/** Moves the end with the start so the length stays (as other calendars do when the start changes). */
export function moveStart(d: Draft, date: string, time: string = d.startTime): Draft {
  if (d.allDay) return { ...d, startDate: date, endDate: addDays(date, Math.max(0, daysBetween(d.startDate, d.endDate))) };
  const length = Math.max(0, stamp(d.endDate, d.endTime) - stamp(d.startDate, d.startTime));
  const end = stamp(date, time) + length;
  const endDate = fromDayNumber(Math.floor(end / 1440));
  return { ...d, startDate: date, startTime: time, endDate, endTime: timeOf(end % 1440) };
}

/** Switching the repeat kind: weekly starts on the weekday of the event. */
export function setRepeatKind(d: Draft, kind: RepeatKind): Draft {
  const weekdays = kind === "weekly" ? [WEEKDAY_CODES[weekdayIndex(d.startDate)]] : [];
  return { ...d, repeat: { kind, interval: 1, weekdays, until: null, count: null } };
}

export function toggleWeekday(d: Draft, code: string): Draft {
  const has = d.repeat.weekdays.includes(code);
  if (has && d.repeat.weekdays.length === 1) return d; // a weekly event needs a weekday
  const weekdays = has ? d.repeat.weekdays.filter((c) => c !== code) : [...d.repeat.weekdays, code];
  weekdays.sort((a, b) => WEEKDAY_CODES.indexOf(a as (typeof WEEKDAY_CODES)[number]) - WEEKDAY_CODES.indexOf(b as (typeof WEEKDAY_CODES)[number]));
  return { ...d, repeat: { ...d.repeat, weekdays } };
}

export function toggleReminder(d: Draft, minutes: number): Draft {
  const has = d.reminders.includes(minutes);
  return { ...d, reminders: has ? d.reminders.filter((m) => m !== minutes) : [...d.reminders, minutes].sort((a, b) => a - b) };
}

/** The first problem with the draft in words, or null when it can be saved. */
export function problem(d: Draft): string | null {
  if (!d.title.trim()) return "Give the event a title.";
  if (d.calendarId === null) return "Pick a calendar.";
  if (d.endDate < d.startDate) return "The event ends before it starts.";
  if (!d.allDay && d.endDate === d.startDate && minutesOf(d.endTime) < minutesOf(d.startTime)) return "The event ends before it starts.";
  if (d.repeat.kind !== "none" && d.repeat.until && d.repeat.until < d.startDate) return "The repeat ends before the event starts.";
  if (d.repeat.kind !== "none" && d.repeat.count !== null && d.repeat.count !== undefined && d.repeat.count < 1) return "Repeat at least once.";
  return null;
}

/** The request body for saving the draft. Call only when `problem` is null. */
export function toInput(d: Draft): CalendarEventInput {
  const repeating = d.repeat.kind !== "none";
  return {
    calendar_id: d.calendarId ?? 0,
    title: d.title.trim(),
    notes: d.notes.trim() || null,
    location: d.location.trim() || null,
    all_day: d.allDay,
    start_date: d.startDate,
    start_time: d.allDay ? null : d.startTime,
    end_date: d.endDate,
    end_time: d.allDay ? null : d.endTime,
    repeat: {
      kind: d.repeat.kind,
      interval: repeating ? Math.min(99, Math.max(1, d.repeat.interval)) : 1,
      weekdays: d.repeat.kind === "weekly" ? d.repeat.weekdays : [],
      until: repeating && d.repeat.count == null ? (d.repeat.until ?? null) : null,
      count: repeating ? (d.repeat.count ?? null) : null,
    },
    exceptions: d.exceptions,
    reminders: d.reminders,
  };
}

/** The occurrence the editor opened from, for the "this event" wording. */
export function isSeries(o: Pick<Occurrence, "repeats">): boolean {
  return o.repeats;
}
