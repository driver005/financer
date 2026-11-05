import { View } from "react-native";

import { size } from "../constants/sizes";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import type { AgendaDay } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The schedule view as Google Calendar draws it: a column on the left with the weekday and the day
 * number (today's number in the accent circle), and to the right of it each event of that day as a
 * filled bar in its calendar's colour with the title and the time range. Days with nothing are left
 * out by the screen. A day with no heading (the list under a phone's month) shows the bars alone.
 */
export function AgendaList({ days, empty }: { days: AgendaDay[]; empty?: string }) {
  if (days.length === 0) {
    return (
      <Box p="xl" align="center">
        <Text tone="muted">{empty ?? "Nothing planned."}</Text>
      </Box>
    );
  }
  return (
    <Box gap="md">
      {days.map((d) => {
        const [y, m, day] = d.date.split("-").map(Number);
        const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
        const number = String(day);
        return (
          <Row key={d.date} gap="md" align="start">
            {d.heading ? (
              <View style={{ width: size.calendar.dateColumn, alignItems: "center" }} accessible accessibilityLabel={d.heading}>
                <Text variant="caption" tone={d.today ? "accent" : "muted"}>{weekday.toUpperCase()}</Text>
                <Box dim="icon-xl" radius="full" align="center" justify="center" bg={d.today ? "accent-solid" : undefined}>
                  <Text variant="subheading" tone={d.today ? "on-accent-solid" : "default"}>{number}</Text>
                </Box>
              </View>
            ) : null}
            <Box grow gap="xs">
              {d.items.map((it) => (
                <Touchable key={it.key} onPress={it.onPress} disabled={!it.onPress} label={`${it.title}, ${it.range}`} hit={false} bg={`${it.tone}-solid`} radius="xl" overflow="hidden" p="md" gap="2xs">
                  <Text variant="bodyStrong" tone={`on-${it.tone}-solid`} numberOfLines={1}>{it.title}</Text>
                  <Text variant="caption" tone={`on-${it.tone}-solid`} numberOfLines={1}>{it.subtitle ? `${it.range} · ${it.subtitle}` : it.range}</Text>
                </Touchable>
              ))}
            </Box>
          </Row>
        );
      })}
    </Box>
  );
}
