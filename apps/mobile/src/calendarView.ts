/**
 * Turns occurrences into what the calendar components draw (month cells, day columns, schedule
 * days, the mini month) and decides which days a view needs. Pure (no React Native), unit-tested.
 */
import {
  WEEKDAY_SHORT,
  addDays,
  dayBlocks,
  groupByDay,
  longDay,
  minutesOf,
  monthGrid,
  monthTitle,
  onDay,
  parseDate,
  startOfWeek,
  timeRange,
  weekOf,
  weekTitle,
  type Occurrence,
} from "./calendar";

export type CalendarView = "month" | "week" | "3day" | "day" | "schedule";

export const VIEWS: readonly { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "3day", label: "3 days" },
  { value: "day", label: "Day" },
  { value: "schedule", label: "Schedule" },
];

/** How many days of the schedule view load at once. */
export const SCHEDULE_DAYS = 60;

/** The first and last day a view needs events for, around the day it is on. */
export function rangeFor(view: CalendarView, anchor: string, scheduleDays: number = SCHEDULE_DAYS): { from: string; to: string } {
  switch (view) {
    case "month": {
      const weeks = monthGrid(anchor);
      return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
    }
    case "week":
      return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) };
    case "3day":
      return { from: anchor, to: addDays(anchor, 2) };
    case "day":
      return { from: anchor, to: anchor };
    case "schedule":
      return { from: anchor, to: addDays(anchor, scheduleDays - 1) };
  }
}

/** Where the previous and next buttons go. */
export function step(view: CalendarView, anchor: string, direction: 1 | -1): string {
  switch (view) {
    case "month": {
      const { y, m, d } = parseDate(anchor);
      const index = y * 12 + (m - 1) + direction;
      const ny = Math.floor(index / 12);
      const nm = (index % 12) + 1;
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    }
    case "week":
      return addDays(anchor, 7 * direction);
    case "3day":
      return addDays(anchor, 3 * direction);
    case "day":
      return addDays(anchor, direction);
    case "schedule":
      return addDays(anchor, 14 * direction);
  }
}

/** The title above the view. */
export function titleFor(view: CalendarView, anchor: string): string {
  if (view === "week") return weekTitle(anchor);
  if (view === "day") return longDay(anchor);
  return monthTitle(anchor);
}

const tidy = (o: Occurrence, onOpen: (o: Occurrence) => void, faded = false) => ({
  key: o.key,
  title: o.title,
  tone: o.tone,
  allDay: o.allDay || o.startDate !== o.endDate,
  time: o.allDay ? undefined : (o.startTime ?? undefined),
  faded,
  onPress: () => onOpen(o),
});

/** How many events a month cell lists on a wide screen before "+N more". */
export const MONTH_CELL_ITEMS = 3;

export function monthCells(anchor: string, today: string, selected: string, occurrences: Occurrence[], onOpen: (o: Occurrence) => void) {
  const weeks = monthGrid(anchor);
  const byDay = groupByDay(occurrences, weeks[0][0], weeks[weeks.length - 1][6]);
  const month = parseDate(anchor).m;
  return weeks.map((week) =>
    week.map((date) => {
      const list = byDay.get(date) ?? [];
      return {
        date,
        number: String(parseDate(date).d),
        inMonth: parseDate(date).m === month,
        today: date === today,
        selected: date === selected,
        items: list.slice(0, MONTH_CELL_ITEMS).map((o) => tidy(o, onOpen)),
        more: Math.max(0, list.length - MONTH_CELL_ITEMS),
      };
    }),
  );
}

export function miniCells(anchor: string, today: string, selected: string, occurrences: Occurrence[]) {
  const weeks = monthGrid(anchor);
  const byDay = groupByDay(occurrences, weeks[0][0], weeks[weeks.length - 1][6]);
  const month = parseDate(anchor).m;
  return weeks.map((week) =>
    week.map((date) => ({
      date,
      number: String(parseDate(date).d),
      inMonth: parseDate(date).m === month,
      today: date === today,
      selected: date === selected,
      marked: (byDay.get(date) ?? []).length > 0,
    })),
  );
}

/** The columns of the week, 3-day and day views. */
export function dayColumns(dates: string[], today: string, selected: string, occurrences: Occurrence[], onOpen: (o: Occurrence) => void) {
  const byDay = groupByDay(occurrences, dates[0], dates[dates.length - 1]);
  return dates.map((date) => {
    const list = byDay.get(date) ?? [];
    const blocks = dayBlocks(list, date).map((b) => ({
      key: b.occurrence.key,
      title: b.occurrence.title,
      subtitle: b.occurrence.location ?? timeRange(b.occurrence),
      tone: b.occurrence.tone,
      top: b.top,
      bottom: b.bottom,
      lane: b.lane,
      lanes: b.lanes,
      depth: b.depth,
      depths: b.depths,
      onPress: () => onOpen(b.occurrence),
    }));
    return {
      date,
      label: WEEKDAY_SHORT[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7],
      number: String(parseDate(date).d),
      today: date === today,
      selected: date === selected,
      allDay: list.filter((o) => o.allDay).map((o) => tidy(o, onOpen)),
      blocks,
    };
  });
}

/** The days of the schedule view that have something on them. */
export function agendaDays(from: string, to: string, today: string, occurrences: Occurrence[], onOpen: (o: Occurrence) => void) {
  const byDay = groupByDay(occurrences, from, to);
  const days = [];
  for (const [date, list] of byDay) {
    if (list.length === 0) continue;
    days.push({
      date,
      heading: date === today ? `Today, ${longDay(date, today)}` : longDay(date, today),
      today: date === today,
      items: list.map((o) => ({ ...tidy(o, onOpen), subtitle: [o.source, o.location].filter(Boolean).join(" · ") || undefined, range: o.allDay ? "All day" : timeRange(o) })),
    });
  }
  return days;
}

/** The minutes since midnight of a `HH:MM` clock, for the line that marks now. */
export function nowMinutes(now: Date): number {
  return minutesOf(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
}

/** Does the occurrence belong on this day (for the detail list under a month on a phone)? */
export const happensOn = onDay;

export { weekOf };
