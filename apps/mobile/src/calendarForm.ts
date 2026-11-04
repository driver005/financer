/**
 * The event editor's draft: what the form edits, how it starts (a new event on a day or at a time,
 * or an existing occurrence), whether it is valid, and the request it turns into. The rules are in
 * Rust (crates/logic, calendar_form.rs); `nextHour` passes the device's hour.
 */
import type { CalendarEvent, CalendarEventInput } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";
import type { EventRule, Repeat, RepeatKind } from "./calendar";

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
export const nextHour = (now: Date): string => logic("app_misc.next_hour", { hour: now.getHours() });

/** A new event on a day, at a time when given, one hour long. */
export const newDraft = (date: string, calendarId: number | null, time?: string | null): Draft =>
  logic("calendar_form.new_draft", { date, calendar_id: calendarId, time: time ?? null });

/** The rule the server stores for an event it sent. */
export const ruleFromDto = (e: CalendarEvent): EventRule => logic("calendar_form.rule_from_dto", { e });

/** The draft for editing an event: its first occurrence's dates (editing changes the whole series). */
export const draftFromRule = (rule: EventRule): Draft => logic("calendar_form.draft_from_rule", { rule });

/** Moves the end with the start so the length stays (as other calendars do when the start changes). */
export const moveStart = (d: Draft, date: string, time: string = d.startTime): Draft => logic("calendar_form.move_start", { d, date, time });

/** Switching the repeat kind: weekly starts on the weekday of the event. */
export const setRepeatKind = (d: Draft, kind: RepeatKind): Draft => logic("calendar_form.set_repeat_kind", { d, kind });

export const toggleWeekday = (d: Draft, code: string): Draft => logic("calendar_form.toggle_weekday", { d, code });

export const toggleReminder = (d: Draft, minutes: number): Draft => logic("calendar_form.toggle_reminder", { d, minutes });

/** The first problem with the draft in words, or null when it can be saved. */
export const problem = (d: Draft): string | null => logic("calendar_form.problem", { d });

/** The request body for saving the draft. Call only when `problem` is null. */
export const toInput = (d: Draft): CalendarEventInput => logic("calendar_form.to_input", { d });
