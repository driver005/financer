import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { expand, type EventRule, type Occurrence } from "../src/calendar";
import { draftFromRule, moveStart, newDraft, problem, setRepeatKind, toInput, toggleReminder, toggleWeekday } from "../src/calendarForm";
import { agendaDays, dayColumns, miniCells, monthCells, rangeFor, step, titleFor } from "../src/calendarView";

const rule = (over: Partial<EventRule> = {}): EventRule => ({
  id: 1,
  calendarId: 1,
  title: "Standup",
  allDay: false,
  startDate: "2026-11-03",
  startTime: "09:00",
  endDate: "2026-11-03",
  endTime: "09:30",
  repeat: { kind: "none", interval: 1, weekdays: [] },
  exceptions: [],
  reminders: [10],
  ...over,
});
const occ = (r: EventRule, from = "2026-11-01", to = "2026-11-30"): Occurrence[] => expand(r, from, to, "accent");
const noop = () => {};

describe("ranges and steps", () => {
  it("a month loads the whole grid, week starts on Monday", () => {
    assert.deepEqual(rangeFor("month", "2026-11-15"), { from: "2026-10-26", to: "2026-12-06" });
    assert.deepEqual(rangeFor("week", "2026-11-05"), { from: "2026-11-02", to: "2026-11-08" });
    assert.deepEqual(rangeFor("3day", "2026-11-05"), { from: "2026-11-05", to: "2026-11-07" });
    assert.deepEqual(rangeFor("day", "2026-11-05"), { from: "2026-11-05", to: "2026-11-05" });
    assert.deepEqual(rangeFor("schedule", "2026-11-05", 10), { from: "2026-11-05", to: "2026-11-14" });
  });
  it("steps by the unit of the view and clamps months", () => {
    assert.equal(step("month", "2026-01-31", 1), "2026-02-28");
    assert.equal(step("month", "2026-01-15", -1), "2025-12-15");
    assert.equal(step("week", "2026-11-05", 1), "2026-11-12");
    assert.equal(step("3day", "2026-11-05", -1), "2026-11-02");
    assert.equal(step("day", "2026-11-05", 1), "2026-11-06");
  });
  it("titles", () => {
    assert.equal(titleFor("month", "2026-11-05"), "November 2026");
    assert.equal(titleFor("day", "2026-11-03"), "Tuesday, 3 November 2026");
  });
});

describe("view models", () => {
  it("month cells mark today, selection, and cut long days to +N more", () => {
    const many = [1, 2, 3, 4, 5].flatMap((i) => occ(rule({ id: i, title: `E${i}` })));
    const cells = monthCells("2026-11-10", "2026-11-03", "2026-11-05", many, noop);
    const cell = cells.flat().find((c) => c.date === "2026-11-03")!;
    assert.equal(cell.today, true);
    assert.equal(cell.items.length, 3);
    assert.equal(cell.more, 2);
    assert.equal(cells.flat().find((c) => c.date === "2026-11-05")!.selected, true);
    assert.equal(cells.flat().find((c) => c.date === "2026-10-30")!.inMonth, false);
  });
  it("mini month marks days with events", () => {
    const cells = miniCells("2026-11-10", "2026-11-03", "2026-11-03", occ(rule()));
    assert.equal(cells.flat().find((c) => c.date === "2026-11-03")!.marked, true);
    assert.equal(cells.flat().find((c) => c.date === "2026-11-04")!.marked, false);
  });
  it("day columns put all-day events in the strip and timed ones in blocks", () => {
    const list = [...occ(rule()), ...occ(rule({ id: 2, title: "Rent", allDay: true, startTime: null, endTime: null }))];
    const [col] = dayColumns(["2026-11-03"], "2026-11-03", "2026-11-03", list, noop);
    assert.equal(col.label, "Tue");
    assert.equal(col.allDay.length, 1);
    assert.equal(col.blocks.length, 1);
    assert.equal(col.blocks[0].top, 540);
    assert.equal(col.blocks[0].bottom, 570);
  });
  it("the schedule skips empty days and names today", () => {
    const days = agendaDays("2026-11-01", "2026-11-30", "2026-11-03", occ(rule({ repeat: { kind: "weekly", interval: 1, weekdays: [] } })), noop);
    assert.deepEqual(days.map((d) => d.date), ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);
    assert.ok(days[0].heading.startsWith("Today, "));
    assert.equal(days[0].items[0].range, "09:00 - 09:30");
  });
});

describe("event draft", () => {
  it("a new event is an hour long and valid once it has a title", () => {
    const d = newDraft("2026-11-03", 1, "14:00");
    assert.equal(d.endTime, "15:00");
    assert.equal(problem(d), "Give the event a title.");
    assert.equal(problem({ ...d, title: "Lunch" }), null);
  });
  it("an hour late in the evening stays on the day", () => {
    assert.equal(newDraft("2026-11-03", 1, "23:30").endTime, "23:59");
  });
  it("moving the start keeps the length, across midnight too", () => {
    const d = { ...newDraft("2026-11-03", 1, "10:00"), title: "x" };
    const m = moveStart(d, "2026-11-04", "23:30");
    assert.equal(m.startDate, "2026-11-04");
    assert.equal(m.endDate, "2026-11-05");
    assert.equal(m.endTime, "00:30");
  });
  it("catches an end before the start", () => {
    const d = { ...newDraft("2026-11-03", 1, "10:00"), title: "x", endTime: "09:00" };
    assert.equal(problem(d), "The event ends before it starts.");
    assert.equal(problem({ ...d, endDate: "2026-11-02" }), "The event ends before it starts.");
  });
  it("weekly starts on the weekday and keeps one", () => {
    const d = setRepeatKind(newDraft("2026-11-03", 1), "weekly");
    assert.deepEqual(d.repeat.weekdays, ["TU"]);
    assert.deepEqual(toggleWeekday(d, "TU").repeat.weekdays, ["TU"]);
    assert.deepEqual(toggleWeekday(toggleWeekday(d, "MO"), "FR").repeat.weekdays, ["MO", "TU", "FR"]);
  });
  it("reminders toggle and stay sorted", () => {
    const d = toggleReminder(toggleReminder(newDraft("2026-11-03", 1), 60), 0);
    assert.deepEqual(d.reminders, [0, 10, 60]);
  });
  it("the request has no times for all-day and only one of until or count", () => {
    const d = { ...newDraft("2026-11-03", 1), title: " Rent ", allDay: true, repeat: { kind: "monthly" as const, interval: 1, weekdays: [], until: "2027-01-01", count: 3 } };
    const input = toInput(d);
    assert.equal(input.title, "Rent");
    assert.equal(input.start_time, null);
    assert.equal(input.repeat.until, null);
    assert.equal(input.repeat.count, 3);
  });
  it("a rule round-trips through the draft", () => {
    const r = rule({ repeat: { kind: "weekly", interval: 2, weekdays: ["MO", "TH"], until: "2027-01-01", count: null }, reminders: [10, 60] });
    const input = toInput(draftFromRule(r));
    assert.equal(input.repeat.interval, 2);
    assert.deepEqual(input.repeat.weekdays, ["MO", "TH"]);
    assert.equal(input.repeat.until, "2027-01-01");
    assert.deepEqual(input.reminders, [10, 60]);
  });
});
