import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CalendarEvent } from "../src/api/types";
import { agendaDays, parseClock, parseDay, rangeEnd, sourceNote, timeText } from "../src/logic/agenda";

const f = { locale: "en-GB" };
const TODAY = "2026-11-03";

function ev(id: number, start: string, o: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    status: "active",
    message: null,
    uid: `u${id}`,
    title: `Event ${id}`,
    start,
    end: null,
    all_day: false,
    location: null,
    description: null,
    organizer: null,
    source: "invite",
    sequence: 0,
    cancelled: false,
    recurrence: null,
    note: null,
    ...o,
  };
}

describe("agendaDays", () => {
  it("groups by the day an event starts, soonest first", () => {
    const days = agendaDays([ev(1, "2026-11-06T19:00"), ev(2, "2026-11-03T08:30"), ev(3, "2026-11-06T09:00")], { from: TODAY, today: TODAY, fmt: f });
    assert.deepEqual(days.map((d) => [d.key, d.events.map((e) => e.id)]), [["2026-11-03", [2]], ["2026-11-06", [3, 1]]]);
    assert.deepEqual([days[0].label, days[0].today, days[0].weekday, days[0].day], ["Today", true, "Tue", "3"]);
    assert.equal(days[1].label, "Fri 6 Nov");
  });

  it("lists an event that began before the window on the first day of it", () => {
    const trip = ev(1, "2026-10-30T00:00", { all_day: true, end: "2026-11-05T00:00" });
    const days = agendaDays([trip], { from: TODAY, today: TODAY, fmt: f });
    assert.deepEqual(days.map((d) => d.key), [TODAY]);
  });

  it("is empty for no events", () => {
    assert.deepEqual(agendaDays([], { from: TODAY, today: TODAY }), []);
  });
});

describe("timeText", () => {
  it("writes a time, a range, and a range over midnight", () => {
    assert.equal(timeText(ev(1, "2026-11-06T19:00"), TODAY, f), "19:00");
    assert.equal(timeText(ev(1, "2026-11-06T19:00", { end: "2026-11-06T21:30" }), TODAY, f), "19:00 – 21:30");
    assert.equal(timeText(ev(1, "2026-11-06T22:00", { end: "2026-11-07T01:00" }), TODAY, f), "22:00 – Sat 7 Nov 01:00");
  });

  it("writes all-day events", () => {
    assert.equal(timeText(ev(1, "2026-12-24T00:00", { all_day: true }), TODAY, f), "All day");
    assert.equal(timeText(ev(1, "2026-12-24T00:00", { all_day: true, end: "2026-12-26T00:00" }), TODAY, f), "All day, until Sat 26 Dec");
  });
});

describe("notes and ranges", () => {
  it("says where an event came from, and that a guess should be checked", () => {
    assert.match(sourceNote("text"), /check/);
    assert.equal(sourceNote("invite"), "From an invitation");
    assert.equal(sourceNote("manual"), "Added by you");
  });

  it("ends the window a number of days ahead", () => {
    assert.equal(rangeEnd("2026-11-03", "14"), "2026-11-17");
    assert.equal(rangeEnd("2026-11-03", "92"), "2027-02-03");
  });
});

describe("typed dates and times", () => {
  it("reads times", () => {
    assert.equal(parseClock("14:30"), "14:30");
    assert.equal(parseClock(" 9 "), "09:00");
    assert.equal(parseClock("9.05"), "09:05");
    assert.equal(parseClock("24:00"), null);
    assert.equal(parseClock("12:60"), null);
    assert.equal(parseClock("abc"), null);
    assert.equal(parseClock(""), null);
  });

  it("reads days in both notations", () => {
    assert.equal(parseDay("2026-11-12", TODAY), "2026-11-12");
    assert.equal(parseDay("12.11.2026", TODAY), "2026-11-12");
    assert.equal(parseDay("12.11.", TODAY), "2026-11-12");
    assert.equal(parseDay("5.1.", TODAY), "2027-01-05", "a day in the past of this year means next year");
    assert.equal(parseDay("31.02.2026", TODAY), null);
    assert.equal(parseDay("2026-13-01", TODAY), null);
    assert.equal(parseDay("tomorrow", TODAY), null);
  });
});
