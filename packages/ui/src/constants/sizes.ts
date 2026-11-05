// Sizes of things, all taken from the spacing scale so there is no stray number anywhere.
import { spacing } from "./spacing";

/** Widest content columns, as Tailwind's `max-w-*` screens (640, 768, 1024, 1280). */
const content = { narrow: 640, normal: 768, wide: 1024, full: 1280 } as const;

export const size = {
  /** Minimum touch target: 44 pt (Apple HIG); Material asks 48 dp, so `touchComfortable` for primary actions. */
  touch: spacing[11],
  touchComfortable: spacing[12],
  /** Heights of buttons, inputs and segments: HeroUI's 40, 48 and 56, and a 32 for small pills (chips) that get a larger hit area. */
  control: { xs: spacing[8], sm: spacing[10], md: spacing[12], lg: spacing[14] },
  /** The switch: HeroUI's 48 x 24 track and 28 x 20 thumb, inset 2. */
  switch: { width: spacing[12], height: spacing[6], thumbWidth: spacing[7], thumbHeight: spacing[5], inset: spacing[0.5], travel: spacing[12] - spacing[7] - spacing[0.5] - spacing[0.5] },
  icon: { xs: spacing[3.5], sm: spacing[4], md: spacing[5], lg: spacing[6], xl: spacing[8] },
  avatar: { sm: spacing[8], md: spacing[10], lg: spacing[14], xl: spacing[20] },
  thumb: { sm: spacing[16], md: spacing[24], lg: spacing[40] },
  ring: { sm: spacing[10], md: spacing[14], lg: spacing[24], xl: spacing[48] },
  /** Line widths of rings and charts. */
  stroke: { hair: spacing.px, sm: spacing[0.5], md: spacing[1], lg: spacing[2], xl: spacing[4] },
  bar: { sm: spacing[1.5], md: spacing[2], lg: spacing[3] },
  chart: { sm: spacing[10], md: spacing[16], lg: spacing[24] },
  nav: { bottomBar: spacing[16], rail: spacing[20], sidebar: spacing[64] },
  table: { row: spacing[14], label: spacing[36], column: spacing[40] },
  /** Height of a live preview in the catalog (an app shell, a table with a sticky header). */
  preview: spacing[96],
  /** A dialog or sheet on a wide screen stays this wide; on a phone it is full width. */
  sheet: { maxWidth: content.narrow, handle: spacing[1], handleWidth: spacing[10] },
  /** The calendar: height of one hour in the day and week views, the hour labels, month cells */
  calendar: { hour: spacing[14], gutter: spacing[12], monthCell: spacing[24], monthCellCompact: spacing[20], dot: spacing[1.5], nowDot: spacing[2.5], dateColumn: spacing[12], allDayRow: spacing[6], miniCell: spacing[9] },
  content,
} as const;

export type IconSize = keyof typeof size.icon;
export type ControlSize = keyof typeof size.control;
