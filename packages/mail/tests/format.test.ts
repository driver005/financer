import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ago, clock, dayKey, dayLabel, dayOfMonth, dayText, daysBetween, listGroup, listTime, localClock, shiftDay, weekdayShort } from "../src/logic/format";

const f = { locale: "en-GB", timeZone: "Europe/Berlin" };
// 2026-11-03 09:00 UTC = 10:00 in Berlin, a Tuesday
const NOW = Date.UTC(2026, 10, 3, 9, 0, 0) / 1000;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

describe("days", () => {
  it("names the calendar day in the given zone, not in UTC", () => {
    // 23:30 UTC on the 2nd is already the 3rd in Berlin
    assert.equal(dayKey(at(2026, 11, 2, 23, 30), f), "2026-11-03");
    assert.equal(dayKey(at(2026, 11, 2, 23, 30), { ...f, timeZone: "UTC" }), "2026-11-02");
  });

  it("moves and measures days across month and year ends", () => {
    assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
    assert.equal(daysBetween("2026-11-03", "2026-11-10"), 7);
    assert.equal(daysBetween("2026-11-10", "2026-11-03"), -7);
  });

  it("writes weekday and day of the month", () => {
    assert.equal(weekdayShort("2026-11-06", f), "Fri");
    assert.equal(dayOfMonth("2026-11-06"), "6");
    assert.equal(weekdayShort("2026-11-06", { locale: "de-DE" }), "Fr");
  });

  it("labels days in words near today and by date further away", () => {
    assert.equal(dayLabel("2026-11-03", "2026-11-03", f), "Today");
    assert.equal(dayLabel("2026-11-04", "2026-11-03", f), "Tomorrow");
    assert.equal(dayLabel("2026-11-02", "2026-11-03", f), "Yesterday");
    assert.equal(dayLabel("2026-11-06", "2026-11-03", f), "Fri 6 Nov");
    assert.equal(dayText("2027-01-08", "2026-11-03", f), "Fri 8 Jan 2027", "another year shows the year");
  });
});

describe("times", () => {
  it("writes the clock in the zone", () => {
    assert.equal(clock(NOW, f), "10:00");
    assert.equal(clock(NOW, { ...f, timeZone: "UTC" }), "09:00");
  });

  it("writes a local event time as it is, without moving it", () => {
    assert.equal(localClock("2026-11-06T19:00", f), "19:00");
    assert.equal(localClock("2026-11-06T07:05", { locale: "en-US" }), "07:05 AM");
  });

  it("shortens times in a conversation list", () => {
    assert.equal(listTime(at(2026, 11, 3, 6, 15), NOW, f), "07:15", "today: the time");
    assert.equal(listTime(at(2026, 11, 2, 12), NOW, f), "Yesterday");
    assert.equal(listTime(at(2026, 10, 30, 12), NOW, f), "Fri", "this week: the weekday");
    assert.equal(listTime(at(2026, 10, 20, 12), NOW, f), "20 Oct", "older: the date");
    assert.equal(listTime(at(2025, 12, 24, 12), NOW, f), "24 Dec 2025", "another year: with the year");
  });

  it("groups a conversation list under Today, Yesterday, This week and Earlier", () => {
    assert.equal(listGroup(at(2026, 11, 3, 6, 15), NOW, f), "Today");
    assert.equal(listGroup(at(2026, 11, 2, 12), NOW, f), "Yesterday");
    assert.equal(listGroup(at(2026, 10, 30, 12), NOW, f), "This week");
    assert.equal(listGroup(at(2026, 10, 20, 12), NOW, f), "Earlier");
  });

  it("says how long ago", () => {
    assert.equal(ago(NOW - 5, NOW), "just now");
    assert.equal(ago(NOW - 5 * 60, NOW), "5 min ago");
    assert.equal(ago(NOW - 3 * 3600, NOW), "3 h ago");
    assert.equal(ago(NOW - 86_400, NOW), "1 day ago");
    assert.equal(ago(NOW - 3 * 86_400, NOW), "3 days ago");
    assert.equal(ago(NOW + 100, NOW), "just now", "a clock that is a little ahead");
  });
});
