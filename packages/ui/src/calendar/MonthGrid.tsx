import { View } from "react-native";

import { borderWidth } from "../constants/radius";
import { size } from "../constants/sizes";
import { Box, Row } from "../primitives/Box";
import { Dot } from "../primitives/Dot";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useLayout } from "../responsive/useLayout";
import { useTheme } from "../theme/ThemeProvider";
import type { CalendarItem, MonthCell } from "./types";

/**
 * A month the way Google Calendar draws it: weekday names, then the weeks, each day with its number
 * and a coloured bar with the title of each of its first events (all-day events filled, timed ones
 * soft with a dot) and "+2" for the rest. Tapping a day selects it; tapping an event opens it.
 */
export function MonthGrid({ weekdays, weeks, onSelectDay }: { weekdays: string[]; weeks: MonthCell[][]; onSelectDay: (date: string) => void }) {
  const { colors } = useTheme();
  const { layout } = useLayout();
  const wide = layout !== "compact";
  const cell = wide ? size.calendar.monthCell : size.calendar.monthCellCompact;
  return (
    <Box accessibilityRole="grid">
      <Row>
        {weekdays.map((w, i) => (
          <Box key={`${w}-${i}`} equal align="center" py="xs"><Text variant="caption" tone="muted">{w}</Text></Box>
        ))}
      </Row>
      {weeks.map((week, i) => (
        <View key={i} style={{ flexDirection: "row", borderTopWidth: borderWidth.hairline, borderTopColor: colors.border.default }}>
          {week.map((c) => (
            <View key={c.date} style={{ flex: 1, minHeight: cell, minWidth: 0 }}>
              <Touchable
                onPress={() => onSelectDay(c.date)}
                label={`${c.date}${c.today ? ", today" : ""}${c.items.length + c.more ? `, ${c.items.length + c.more} events` : ""}`}
                role="button"
                selected={c.selected}
                hit={false}
                p="2xs"
                gap="2xs"
                align="center"
                grow
                bg={c.selected ? "accent-soft" : undefined}
              >
                <Box dim="icon-lg" radius="full" align="center" justify="center" bg={c.today ? "accent-solid" : undefined}>
                  <Text variant="caption" tone={c.today ? "on-accent-solid" : c.inMonth ? "default" : "subtle"}>{c.number}</Text>
                </Box>
                <Box full gap="2xs">
                  {c.items.map((it) => (
                    <Chip key={it.key} item={it} solid={!wide} />
                  ))}
                  {c.more > 0 ? <Text variant="caption" tone="muted" numberOfLines={1}>{`+${c.more}`}</Text> : null}
                </Box>
              </Touchable>
            </View>
          ))}
        </View>
      ))}
    </Box>
  );
}

/** On a phone every event is a solid bar with only its title, as there is no room for a time; on a wide screen a timed one is soft with a dot and its time. */
function Chip({ item, solid }: { item: CalendarItem; solid: boolean }) {
  const { colors } = useTheme();
  const body = (
    <Row gap="2xs" px="xs" radius="sm" bg={item.allDay || solid ? `${item.tone}-solid` : `${item.tone}-soft`} align="center">
      {item.allDay || solid ? null : <Dot color={colors.tones[item.tone].solid} />}
      <Box grow>
        <Text variant="caption" tone={item.allDay || solid ? `on-${item.tone}-solid` : `on-${item.tone}-soft`} numberOfLines={1}>
          {item.time && !solid ? `${item.time} ${item.title}` : item.title}
        </Text>
      </Box>
    </Row>
  );
  return item.onPress ? (
    <Touchable onPress={item.onPress} label={item.title} hit={false}>{body}</Touchable>
  ) : (
    body
  );
}

