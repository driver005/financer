import { useState } from "react";

import { AgendaList, Box, FloatingButton, MiniMonth, MonthGrid, Stack, Text, TimeGrid, TimePicker, type AgendaDay, type CalendarItem, type DayColumn, type MiniCell, type MonthCell, type TimeBlock } from "@financer/ui";

import type { StoryDef } from "../Story";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const item = (key: string, title: string, tone: CalendarItem["tone"], time?: string, allDay = false): CalendarItem => ({ key, title, tone, allDay, time, onPress: () => {} });
const block = (key: string, title: string, tone: TimeBlock["tone"], from: number, to: number, depth = 0, depths = 1, subtitle?: string, lane = 0, lanes = 1): TimeBlock => ({ key, title, subtitle, tone, top: from, bottom: to, lane, lanes, depth, depths, onPress: () => {} });
const minutes = (h: number, m = 0) => h * 60 + m;

const day = (n: number): string => `2026-11-${String(n).padStart(2, "0")}`;

function monthWeeks(): MonthCell[][] {
  const weeks: MonthCell[][] = [];
  // the grid starts on Monday 26 October 2026; six weeks.
  for (let w = 0; w < 6; w += 1) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const offset = w * 7 + d - 5; // 1 November (a Sunday) is the 7th cell
      const inMonth = offset >= 1 && offset <= 30;
      const date = inMonth ? day(offset) : `${offset < 1 ? "2026-10" : "2026-12"}-${String(offset < 1 ? 31 + offset : offset - 30).padStart(2, "0")}`;
      const items: CalendarItem[] = [];
      if (offset === 3) items.push(item("a", "Standup", "accent", "09:00"), item("b", "Rent", "danger", undefined, true));
      if (offset === 5) items.push(item("c", "Dentist", "info", "14:30"));
      if (offset === 12) items.push(item("d", "Payday", "success", undefined, true), item("e", "Streaming", "warning"), item("f", "Gym", "accent", "18:00"), item("g", "Dinner", "neutral", "20:00"));
      row.push({ date, number: String(new Date(`${date}T00:00:00`).getDate()), inMonth, today: offset === 3, selected: offset === 5, items: items.slice(0, 3), more: Math.max(0, items.length - 3) });
    }
    weeks.push(row);
  }
  return weeks;
}

function Month() {
  const [sel, setSel] = useState("");
  return (
    <Stack gap="sm">
      <MonthGrid weekdays={WEEKDAYS} weeks={monthWeeks().map((w) => w.map((c) => ({ ...c, selected: c.date === sel || (sel === "" && c.selected) })))} onSelectDay={setSel} />
    </Stack>
  );
}

function week(): DayColumn[] {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return labels.map((label, i) => ({
    date: day(2 + i),
    label,
    number: String(2 + i),
    today: i === 1,
    allDay: i === 1 ? [item("rent", "Rent due", "danger", undefined, true)] : [],
    blocks:
      i === 1
        ? [block("s", "Standup", "accent", minutes(9), minutes(9, 30)), block("w", "Deep work", "info", minutes(9, 30), minutes(12), 0, 2, "Home"), block("l", "Lunch with Sam", "success", minutes(11, 30), minutes(13), 1, 2), block("g", "Gym", "warning", minutes(18), minutes(19, 30))]
        : i === 3
          ? [block("d", "Dentist", "info", minutes(14, 30), minutes(15, 15), 0, 1, "Dr. Weber")]
          : [],
  }));
}

function Week() {
  return (
    <Box h="preview">
      <TimeGrid days={week()} nowMinutes={minutes(10, 15)} onSlot={() => {}} onSelectDay={() => {}} />
    </Box>
  );
}

function Day() {
  return (
    <Box h="preview">
      <TimeGrid days={week().slice(1, 2)} nowMinutes={minutes(10, 15)} onSlot={() => {}} />
    </Box>
  );
}

function agenda(): AgendaDay[] {
  return [
    { date: day(3), heading: "Today, Tuesday 3 November", today: true, items: [{ ...item("1", "Standup", "accent", "09:00"), range: "09:00 – 09:30", subtitle: "Office" }, { ...item("2", "Rent due", "danger", undefined, true), range: "All day", subtitle: "Finance" }] },
    { date: day(5), heading: "Thursday 5 November", today: false, items: [{ ...item("3", "Dentist", "info", "14:30"), range: "14:30 – 15:15", subtitle: "Dr. Weber" }] },
  ];
}

function Schedule() {
  return <AgendaList days={agenda()} />;
}

function mini(): MiniCell[][] {
  return monthWeeks().map((w) => w.map((c) => ({ date: c.date, number: c.number, inMonth: c.inMonth, today: c.today, selected: c.selected, marked: c.items.length > 0 })));
}

function Mini() {
  const [sel, setSel] = useState("");
  return <MiniMonth title="November 2026" weekdays={["M", "T", "W", "T", "F", "S", "S"]} weeks={mini().map((w) => w.map((c) => ({ ...c, selected: c.date === sel || (sel === "" && c.selected) })))} onSelect={setSel} onPrev={() => {}} onNext={() => {}} />;
}

function Time() {
  const [t, setT] = useState("09:30");
  return (
    <Stack gap="md">
      <Text variant="bodyStrong">{t}</Text>
      <TimePicker value={t} onChange={setT} />
    </Stack>
  );
}

function Fab() {
  return (
    <Box h="preview">
      <FloatingButton label="Create" onPress={() => {}} />
    </Box>
  );
}

export const calendarStories: StoryDef[] = [
  { id: "month", title: "MonthGrid", note: "A month: dots on a phone, event chips and “+N more” on a tablet or laptop. Tap a day to select it.", render: () => <Month /> },
  { id: "week", title: "TimeGrid, week", note: "Days as columns, hours down the side, an all-day strip, overlapping events side by side and a line for now.", render: () => <Week /> },
  { id: "day", title: "TimeGrid, one day", note: "The same grid with one column (the day view; three columns is the 3-day view).", render: () => <Day /> },
  { id: "schedule", title: "AgendaList", note: "The schedule view: day by day, an event per row.", render: () => <Schedule /> },
  { id: "mini", title: "MiniMonth", note: "A small month to jump to a day or to pick a date; a dot marks days with events.", render: () => <Mini /> },
  { id: "time", title: "TimePicker", note: "Hour, then minute in steps of five.", render: () => <Time /> },
  { id: "fab", title: "FloatingButton", note: "The round add button over the corner of the page; the label shows on wide screens.", render: () => <Fab /> },
];
