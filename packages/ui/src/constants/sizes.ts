// Sizes of things, all taken from the spacing scale so there is no stray number anywhere.
import { spacing } from "./spacing";

/** Widest content columns, as Tailwind's `max-w-*` screens (640, 768, 1024, 1280). */
const content = { narrow: 640, normal: 768, wide: 1024, full: 1280 } as const;

export const size = {
  /** Minimum touch target: 44 pt (Apple HIG); Material asks 48 dp, so `touchComfortable` for primary actions. */
  touch: spacing[11],
  touchComfortable: spacing[12],
  control: { sm: spacing[9], md: spacing[11], lg: spacing[12] },
  icon: { xs: spacing[3.5], sm: spacing[4], md: spacing[5], lg: spacing[6], xl: spacing[8] },
  avatar: { sm: spacing[8], md: spacing[10], lg: spacing[14] },
  thumb: { sm: spacing[16], md: spacing[24], lg: spacing[40] },
  ring: { sm: spacing[10], md: spacing[14], lg: spacing[24] },
  bar: { sm: spacing[1.5], md: spacing[2], lg: spacing[3] },
  chart: { sm: spacing[10], md: spacing[16], lg: spacing[24] },
  nav: { bottomBar: spacing[16], rail: spacing[20], sidebar: spacing[64] },
  table: { row: spacing[14], label: spacing[36], column: spacing[40] },
  /** Height of a live preview in the catalog (an app shell, a table with a sticky header). */
  preview: spacing[96],
  /** A dialog or sheet on a wide screen stays this wide; on a phone it is full width. */
  sheet: { maxWidth: content.narrow, handle: spacing[1] },
  content,
} as const;

export type IconSize = keyof typeof size.icon;
export type ControlSize = keyof typeof size.control;
