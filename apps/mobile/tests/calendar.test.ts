import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  addMonths,
  dayBlocks,
  expand,
  groupByDay,
  monthGrid,
  parseQuickAdd,
  repeatText,
  reminderText,
  seriesStarts,
  startOfWeek,
  timeRange,
  weekOf,
  weekTitle,
  weekdayIndex,
  type EventRule,
  type Occurrence,
} from "../src/calendar";

const rule = (over: Partial<Omit<EventRule, "repeat">> & { repeat?: Partial<EventRule["repeat"]> } = {}): EventRule => ({
  id: 1,
  calendarId: 1,
  title: "Gym",
  allDay: false,
  startDate: "2026-11-02",
  startTime: "18:00",
  endDate: "2026-11-02",
  endTime: "19:00",
  exceptions: [],
  reminders: [],
  ...over,
  repeat: { kind: "none", interval: 1, weekdays: [], ...over.repeat },
});

describe("dates", () => {
  it("knows the weekday and the week", () => {
    assert.equal(weekdayIndex("2026-11-02"), 0); // a Monday
    assert.equal(weekdayIndex("2026-11-08"), 6);
    assert.equal(startOfWeek("2026-11-05"), "2026-11-02");
    assert.deepEqual(weekOf("2026-11-08"), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });
  it("adds days across months and years", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });
  it("adds months and clamps to the last day", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
    assert.equal(addMonths("2026-01-15", -2), "2025-11-15");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  });
  it("lays a month out in whole weeks that start on Monday", () => {
    const grid = monthGrid("2026-11-15");
    assert.ok(grid.every((w) => w.length === 7 && weekdayIndex(w[0]) === 0));
    assert.equal(grid[0][0], "2026-10-26");
    assert.equal(grid.at(-1)![6], "2026-12-06");
    assert.equal(grid.length, 6);
    // February 2027 starts on a Monday and has 28 days: exactly four rows
    assert.equal(monthGrid("2027-02-10").length, 4);
  });
  it("names a week", () => {
    assert.equal(weekTitle("2026-11-03"), "2 - 8 Nov 2026");
    assert.equal(weekTitle("2026-10-28"), "26 Oct - 1 Nov 2026");
    assert.equal(weekTitle("2026-12-30"), "28 Dec 2026 - 3 Jan 2027");
  });
});

describe("repeats", () => {
  it("a single event is found only inside the range", () => {
    assert.deepEqual(seriesStarts(rule(), "2026-11-01", "2026-11-30"), ["2026-11-02"]);
    assert.deepEqual(seriesStarts(rule(), "2026-11-03", "2026-11-30"), []);
  });
  it("repeats daily with an interval", () => {
    const r = rule({ repeat: { kind: "daily", interval: 3 } });
    assert.deepEqual(seriesStarts(r, "2026-11-01", "2026-11-12"), ["2026-11-02", "2026-11-05", "2026-11-08", "2026-11-11"]);
  });
  it("repeats weekly on the start weekday, or on chosen weekdays", () => {
    assert.deepEqual(seriesStarts(rule({ repeat: { kind: "weekly" } }), "2026-11-01", "2026-11-22"), ["2026-11-02", "2026-11-09", "2026-11-16"]);
    const mwf = rule({ repeat: { kind: "weekly", weekdays: ["MO", "WE", "FR"] } });
    assert.deepEqual(seriesStarts(mwf, "2026-11-01", "2026-11-14"), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"]);
  });
  it("every other week skips the weeks in between and never goes before the start", () => {
    const r = rule({ startDate: "2026-11-04", endDate: "2026-11-04", repeat: { kind: "weekly", interval: 2, weekdays: ["MO", "WE"] } });
    // the Monday of the first week is before the start: not an occurrence
    assert.deepEqual(seriesStarts(r, "2026-11-01", "2026-12-06"), ["2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30", "2026-12-02"]);
  });
  it("repeats monthly and yearly, clamping short months", () => {
    const monthly = rule({ startDate: "2026-01-31", endDate: "2026-01-31", repeat: { kind: "monthly" } });
    assert.deepEqual(seriesStarts(monthly, "2026-01-01", "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    const yearly = rule({ startDate: "2024-02-29", endDate: "2024-02-29", repeat: { kind: "yearly" } });
    assert.deepEqual(seriesStarts(yearly, "2025-01-01", "2028-12-31"), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });
  it("stops at the until date (inclusive) or after the count, counting skipped ones too", () => {
    const until = rule({ repeat: { kind: "daily", until: "2026-11-04" } });
    assert.deepEqual(seriesStarts(until, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-03", "2026-11-04"]);
    const count = rule({ repeat: { kind: "daily", count: 3 }, exceptions: ["2026-11-03"] });
    assert.deepEqual(seriesStarts(count, "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-04"]);
    // a range that starts in the middle still counts from the first start
    const late = rule({ repeat: { kind: "daily", count: 5 } });
    assert.deepEqual(seriesStarts(late, "2026-11-05", "2026-11-30"), ["2026-11-05", "2026-11-06"]);
  });
  it("leaves out deleted occurrences", () => {
    const r = rule({ repeat: { kind: "weekly" }, exceptions: ["2026-11-09"] });
    assert.deepEqual(seriesStarts(r, "2026-11-01", "2026-11-22"), ["2026-11-02", "2026-11-16"]);
  });
  it("cannot be made to run away", () => {
    const r = rule({ startDate: "1900-01-01", endDate: "1900-01-01", repeat: { kind: "daily" } });
    assert.ok(seriesStarts(r, "2026-11-01", "2026-11-30").length <= 30);
  });
});

describe("occurrences", () => {
  it("carry the event's data and a key of their own", () => {
    const occs = expand(rule({ repeat: { kind: "weekly" } }), "2026-11-01", "2026-11-14", "info");
    assert.deepEqual(occs.map((o) => o.key), ["1:2026-11-02", "1:2026-11-09"]);
    assert.ok(occs.every((o) => o.repeats && !o.readOnly && o.tone === "info" && o.startTime === "18:00"));
  });
  it("a multi-day event shows while it runs, also when it began before the range", () => {
    const trip = rule({ title: "Trip", allDay: true, startTime: null, endTime: null, startDate: "2026-10-30", endDate: "2026-11-03" });
    const [o] = expand(trip, "2026-11-02", "2026-11-10", "success");
    assert.equal(o.startDate, "2026-10-30");
    assert.equal(o.endDate, "2026-11-03");
    assert.deepEqual(expand(trip, "2026-11-04", "2026-11-10", "success"), []);
  });
  it("a repeating multi-day event keeps its length in every run", () => {
    const camp = rule({ allDay: true, startTime: null, endTime: null, startDate: "2026-11-02", endDate: "2026-11-04", repeat: { kind: "weekly" } });
    const occs = expand(camp, "2026-11-08", "2026-11-12", "danger");
    assert.deepEqual(occs.map((o) => [o.startDate, o.endDate]), [["2026-11-09", "2026-11-11"]]);
  });
  it("are grouped by day, all-day first", () => {
    const day = expand(rule({ title: "Lunch", startTime: "12:00", endTime: "13:00" }), "2026-11-01", "2026-11-30", "accent");
    const allDay = expand(rule({ id: 2, title: "Holiday", allDay: true, startTime: null, endTime: null }), "2026-11-01", "2026-11-30", "accent");
    const grouped = groupByDay([...day, ...allDay], "2026-11-01", "2026-11-03");
    assert.deepEqual(grouped.get("2026-11-02")!.map((o) => o.title), ["Holiday", "Lunch"]);
    assert.deepEqual(grouped.get("2026-11-01"), []);
    assert.equal(grouped.size, 3);
  });
});

describe("the day column", () => {
  const occ = (id: number, start: string, end: string, extra: Partial<Occurrence> = {}): Occurrence => ({
    key: String(id), eventId: id, calendarId: 1, title: `e${id}`, allDay: false, startDate: "2026-11-03", startTime: start, endDate: "2026-11-03", endTime: end,
    tone: "accent", repeats: false, readOnly: false, ...extra,
  });
  it("gives an event alone the whole width", () => {
    const [b] = dayBlocks([occ(1, "09:00", "10:00")], "2026-11-03");
    assert.deepEqual([b.top, b.bottom, b.column, b.columns], [540, 600, 0, 1]);
  });
  it("puts overlapping events side by side and lets later ones reuse a free column", () => {
    const blocks = dayBlocks([occ(1, "09:00", "11:00"), occ(2, "10:00", "12:00"), occ(3, "11:00", "12:00"), occ(4, "13:00", "14:00")], "2026-11-03");
    const by = Object.fromEntries(blocks.map((b) => [b.occurrence.eventId, [b.column, b.columns]]));
    assert.deepEqual(by[1], [0, 2]);
    assert.deepEqual(by[2], [1, 2]);
    assert.deepEqual(by[3], [0, 2]); // starts when e1 ended
    assert.deepEqual(by[4], [0, 1]); // a new cluster
  });
  it("lays events that start together side by side and later ones on top", () => {
    const blocks = dayBlocks([occ(1, "09:00", "10:00"), occ(2, "09:10", "10:30"), occ(3, "09:45", "11:00"), occ(4, "10:00", "10:30")], "2026-11-03");
    const by = Object.fromEntries(blocks.map((b) => [b.occurrence.eventId, [b.lane, b.lanes, b.depth, b.depths]]));
    assert.deepEqual(by[1], [0, 2, 0, 2]); // 1 and 2 start within half an hour: side by side
    assert.deepEqual(by[2], [1, 2, 0, 2]);
    assert.deepEqual(by[3], [0, 2, 1, 2]); // 3 and 4 start later and lie on top of them
    assert.deepEqual(by[4], [1, 2, 1, 2]);
  });
  it("draws a very short event at a size that can be tapped", () => {
    const [b] = dayBlocks([occ(1, "09:00", "09:05")], "2026-11-03");
    assert.equal(b.bottom - b.top, 30);
  });
  it("cuts an event that runs past midnight at the edges of each day", () => {
    const night = occ(1, "22:00", "02:00", { endDate: "2026-11-04" });
    const [first] = dayBlocks([night], "2026-11-03");
    const [second] = dayBlocks([night], "2026-11-04");
    assert.deepEqual([first.top, first.bottom], [1320, 1440]);
    assert.deepEqual([second.top, second.bottom], [0, 120]);
  });
  it("leaves all-day events to the strip above", () => {
    assert.deepEqual(dayBlocks([occ(1, "09:00", "10:00", { allDay: true })], "2026-11-03"), []);
  });
});

describe("quick add", () => {
  const today = "2026-11-03"; // a Tuesday
  it("reads a day word and a time range", () => {
    assert.deepEqual(parseQuickAdd("Lunch with Anna tomorrow 12:30-13:30", today), { title: "Lunch with Anna", date: "2026-11-04", allDay: false, startTime: "12:30", endTime: "13:30" });
  });
  it("reads am and pm, and gives a start alone an hour", () => {
    const r = parseQuickAdd("Dentist friday 9am", today)!;
    assert.deepEqual([r.title, r.date, r.startTime, r.endTime], ["Dentist", "2026-11-06", "09:00", "10:00"]);
    assert.equal(parseQuickAdd("Call at 3pm today", today)!.startTime, "15:00");
    assert.equal(parseQuickAdd("Standup 9-9:15", today)!.endTime, "09:15");
  });
  it("makes an event without a time all day", () => {
    const r = parseQuickAdd("Anna's birthday 24 dec", today)!;
    assert.deepEqual([r.title, r.date, r.allDay, r.startTime], ["Anna's birthday", "2026-12-24", true, null]);
    assert.equal(parseQuickAdd("Trip all day", today)!.allDay, true);
  });
  it("reads dates in the German and the ISO way, and a day that has passed this year means next year", () => {
    assert.equal(parseQuickAdd("Rent 1.12.", today)!.date, "2026-12-01");
    assert.equal(parseQuickAdd("Rent 1.2.2027", today)!.date, "2027-02-01");
    assert.equal(parseQuickAdd("Tax 2026-12-31", today)!.date, "2026-12-31");
    assert.equal(parseQuickAdd("Old 1 oct", today)!.date, "2027-10-01");
  });
  it("knows today's weekday, next week's and the coming one", () => {
    assert.equal(parseQuickAdd("Meet tuesday", today)!.date, "2026-11-03");
    assert.equal(parseQuickAdd("Meet next tuesday", today)!.date, "2026-11-10");
    assert.equal(parseQuickAdd("Meet monday", today)!.date, "2026-11-09");
  });
  it("falls back to the day on screen and refuses an empty title", () => {
    assert.equal(parseQuickAdd("Read", today, "2026-11-20")!.date, "2026-11-20");
    assert.equal(parseQuickAdd("tomorrow 10:00", today), null);
    assert.equal(parseQuickAdd("   ", today), null);
  });
});

describe("words", () => {
  it("says a repeat", () => {
    assert.equal(repeatText(undefined), "Does not repeat");
    assert.equal(repeatText({ kind: "daily", interval: 1, weekdays: [] }), "Every day");
    assert.equal(repeatText({ kind: "weekly", interval: 2, weekdays: ["MO", "TH"] }), "Every 2 weeks on Mon, Thu");
    assert.equal(repeatText({ kind: "yearly", interval: 1, weekdays: [], until: "2030-05-01" }), "Every year, until 1 May 2030");
    assert.equal(repeatText({ kind: "monthly", interval: 1, weekdays: [], count: 12 }), "Every month, 12 times");
  });
  it("says a reminder", () => {
    assert.equal(reminderText(0), "At the start");
    assert.equal(reminderText(10), "10 minutes before");
    assert.equal(reminderText(60), "1 hour before");
    assert.equal(reminderText(1440), "1 day before");
    assert.equal(reminderText(20160), "2 weeks before");
  });
  it("says a time range", () => {
    const o = { allDay: false, startTime: "09:00", endTime: "10:30", startDate: "2026-11-03", endDate: "2026-11-03" };
    assert.equal(timeRange(o), "09:00 - 10:30");
    assert.equal(timeRange({ ...o, endDate: "2026-11-05" }), "09:00 - 10:30 (until 5 Nov)");
    assert.equal(timeRange({ ...o, allDay: true }), "All day");
  });
});
