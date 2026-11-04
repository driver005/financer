/**
 * Turns occurrences into what the calendar components draw (month cells, day columns, schedule
 * days, the mini month) and decides which days a view needs. The rules are in Rust (crates/logic,
 * calendar_view.rs); the tap handlers are attached here.
 */
import { logic } from "../../../packages/wire/src/logic";
import { minutesOf, weekOf, type Occurrence, type Tone } from "./calendar";

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
export const rangeFor = (view: CalendarView, anchor: string, scheduleDays: number = SCHEDULE_DAYS): { from: string; to: string } =>
  logic("calendar_view.range_for", { view, anchor, schedule_days: scheduleDays });

/** Where the previous and next buttons go. */
export const step = (view: CalendarView, anchor: string, direction: 1 | -1): string => logic("calendar_view.step", { view, anchor, direction });

/** The title above the view. */
export const titleFor = (view: CalendarView, anchor: string): string => logic("calendar_view.title_for", { view, anchor });
type Open = (o: Occurrence) => void;

/** The rules answer with plain data; a tap handler for each item is attached here, by the key of its occurrence. */
function opener(occurrences: Occurrence[], onOpen: Open): (key: string) => () => void {
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  return (key) => () => {
    const o = byKey.get(key);
    if (o) onOpen(o);
  };
}

type RawItem = { key: string; title: string; tone: Tone; allDay: boolean; time?: string; faded: boolean };
export type CalendarItem = RawItem & { onPress: () => void };

export type MonthCell = {
  date: string;
  number: string;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  items: CalendarItem[];
  more: number;
};

export function monthCells(anchor: string, today: string, selected: string, occurrences: Occurrence[], onOpen: Open): MonthCell[][] {
  const press = opener(occurrences, onOpen);
  const weeks = logic<(Omit<MonthCell, "items"> & { items: RawItem[] })[][]>("calendar_view.month_cells", { anchor, today, selected, occurrences });
  return weeks.map((week) => week.map((cell) => ({ ...cell, items: cell.items.map((i) => ({ ...i, onPress: press(i.key) })) })));
}

export type MiniCell = { date: string; number: string; inMonth: boolean; today: boolean; selected: boolean; marked: boolean };

export const miniCells = (anchor: string, today: string, selected: string, occurrences: Occurrence[]): MiniCell[][] =>
  logic("calendar_view.mini_cells", { anchor, today, selected, occurrences });

export type DayBlock = {
  key: string;
  title: string;
  subtitle: string;
  tone: Tone;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  depth: number;
  depths: number;
  onPress: () => void;
};

export type DayColumn = {
  date: string;
  label: string;
  number: string;
  today: boolean;
  selected: boolean;
  allDay: CalendarItem[];
  blocks: DayBlock[];
};

/** The columns of the week, 3-day and day views. */
export function dayColumns(dates: string[], today: string, selected: string, occurrences: Occurrence[], onOpen: Open): DayColumn[] {
  const press = opener(occurrences, onOpen);
  const columns = logic<(Omit<DayColumn, "allDay" | "blocks"> & { allDay: RawItem[]; blocks: Omit<DayBlock, "onPress">[] })[]>("calendar_view.day_columns", {
    dates,
    today,
    selected,
    occurrences,
  });
  return columns.map((c) => ({
    ...c,
    allDay: c.allDay.map((i) => ({ ...i, onPress: press(i.key) })),
    blocks: c.blocks.map((b) => ({ ...b, onPress: press(b.key) })),
  }));
}

export type AgendaItem = CalendarItem & { subtitle?: string; range: string };
export type AgendaDay = { date: string; heading: string; today: boolean; items: AgendaItem[] };

/** The days of the schedule view that have something on them. */
export function agendaDays(from: string, to: string, today: string, occurrences: Occurrence[], onOpen: Open): AgendaDay[] {
  const press = opener(occurrences, onOpen);
  const days = logic<(Omit<AgendaDay, "items"> & { items: (RawItem & { subtitle?: string; range: string })[] })[]>("calendar_view.agenda_days", {
    from,
    to,
    today,
    occurrences,
  });
  return days.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i, onPress: press(i.key) })) }));
}

/** The minutes since midnight of a `HH:MM` clock, for the line that marks now. */
export function nowMinutes(now: Date): number {
  return minutesOf(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
}
export { weekOf };
