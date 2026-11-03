import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";

export type DateBadgeProps = {
  /** "Fri": the short weekday, already in the person's language. */
  weekday: string;
  /** "6": the day of the month. */
  day: string;
  tone?: Tone;
  /** Today: filled instead of soft. */
  today?: boolean;
};

/** A day as a small calendar tile: the weekday over the date. */
export function DateBadge({ weekday, day, tone = "accent", today }: DateBadgeProps) {
  const text = today ? (`on-${tone}-solid` as const) : (`on-${tone}-soft` as const);
  return (
    <Box dim="avatar-lg" radius="xl" bg={today ? `${tone}-solid` : `${tone}-soft`} align="center" justify="center" shrink={false} accessibilityLabel={`${weekday} ${day}${today ? ", today" : ""}`} accessibilityRole="text">
      <Text variant="caption" tone={text}>{weekday}</Text>
      <Text variant="subheading" tone={text}>{day}</Text>
    </Box>
  );
}
