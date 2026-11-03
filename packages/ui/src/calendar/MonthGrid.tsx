import { View } from "react-native";

import { borderWidth, radius } from "../constants/radius";
import { opacity } from "../constants/misc";
import { size } from "../constants/sizes";
import { Box, Row } from "../primitives/Box";
import { Dot } from "../primitives/Dot";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useLayout } from "../responsive/useLayout";
import { useTheme } from "../theme/ThemeProvider";
import type { CalendarItem, MonthCell } from "./types";

/**
 * A month: weekday names, then the weeks. On a phone a day shows its number and a few coloured dots;
 * on a tablet or laptop it shows the titles of its first events and "+2 more". Tapping a day selects
 * it; tapping an event on a wide screen opens it.
 */
export function MonthGrid({ weekdays, weeks, onSelectDay }: { weekdays: string[]; weeks: MonthCell[][]; onSelectDay: (date: string) => void }) {
  const { colors } = useTheme();
  const { layout } = useLayout();
  const wide = layout !== "compact";
  const cell = wide ? size.calendar.monthCell : size.calendar.monthCellCompact;
  return (
    <Box accessibilityRole="grid">
      <Row>
        {weekdays.map((w) => (
          <Box key={w} equal align="center" py="xs"><Text variant="caption" tone="muted">{w}</Text></Box>
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
                {wide ? (
                  <Box full gap="2xs">
                    {c.items.map((it) => (
                      <Chip key={it.key} item={it} />
                    ))}
                    {c.more > 0 ? <Text variant="caption" tone="muted" numberOfLines={1}>{`+${c.more} more`}</Text> : null}
                  </Box>
                ) : (
                  <Row gap="2xs" justify="center" wrap>
                    {c.items.slice(0, 3).map((it) => (
                      <ToneDot key={it.key} item={it} />
                    ))}
                  </Row>
                )}
              </Touchable>
            </View>
          ))}
        </View>
      ))}
    </Box>
  );
}

function ToneDot({ item }: { item: CalendarItem }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{ width: size.calendar.dot, height: size.calendar.dot, borderRadius: radius.full, backgroundColor: colors.tones[item.tone].solid, opacity: item.faded ? opacity[40] : opacity[100] }}
    />
  );
}

function Chip({ item }: { item: CalendarItem }) {
  const { colors } = useTheme();
  const body = (
    <Row gap="2xs" px="xs" radius="sm" bg={item.allDay ? `${item.tone}-solid` : `${item.tone}-soft`} align="center">
      {item.allDay ? null : <Dot color={colors.tones[item.tone].solid} />}
      <Box grow>
        <Text variant="caption" tone={item.allDay ? `on-${item.tone}-solid` : `on-${item.tone}-soft`} numberOfLines={1}>
          {item.time ? `${item.time} ${item.title}` : item.title}
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

