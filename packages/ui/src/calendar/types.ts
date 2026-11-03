import type { Tone } from "../constants/colors";

/** One event as a chip or a row: the screen decides what to show, the component draws it. */
export type CalendarItem = {
  key: string;
  title: string;
  tone: Tone;
  allDay: boolean;
  /** `09:00`, shown before the title of a timed event. */
  time?: string;
  /** Dimmed (a calendar that is hidden or an event that is over). */
  faded?: boolean;
  onPress?: () => void;
};

/** An event placed in a day column of the week and day views. Minutes count from the start of the day. */
export type TimeBlock = {
  key: string;
  title: string;
  subtitle?: string;
  tone: Tone;
  top: number;
  bottom: number;
  column: number;
  columns: number;
  onPress?: () => void;
};

/** One day of the week and day views. */
export type DayColumn = {
  date: string;
  /** `Mon` */
  label: string;
  /** `3` */
  number: string;
  today: boolean;
  selected?: boolean;
  allDay: CalendarItem[];
  blocks: TimeBlock[];
};

/** One cell of a month. */
export type MonthCell = {
  date: string;
  number: string;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  items: CalendarItem[];
  /** How many more events there are than `items` shows. */
  more: number;
};

/** One day of the schedule list. */
export type AgendaDay = {
  date: string;
  /** `Tuesday, 3 November` */
  heading: string;
  today: boolean;
  items: (CalendarItem & { subtitle?: string; range: string })[];
};

/** One day of the small month used for jumping and for picking a date. */
export type MiniCell = {
  date: string;
  number: string;
  inMonth: boolean;
  today: boolean;
  selected: boolean;
  /** A dot under the number: something is planned that day. */
  marked: boolean;
};
