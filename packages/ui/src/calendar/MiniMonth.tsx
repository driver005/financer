import { View } from "react-native";

import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { IconButton } from "../components/Button";
import { useTheme } from "../theme/ThemeProvider";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import type { MiniCell } from "./types";

/**
 * A small month for jumping to a day (the side panel on a wide screen) and for picking a date in a
 * form. The screen computes the weeks; this draws them and reports taps.
 */
export function MiniMonth({ title, weekdays, weeks, onSelect, onPrev, onNext }: { title: string; weekdays: string[]; weeks: MiniCell[][]; onSelect: (date: string) => void; onPrev: () => void; onNext: () => void }) {
  const { colors } = useTheme();
  return (
    <Box gap="xs">
      <Row justify="between" align="center">
        <Text variant="bodyStrong">{title}</Text>
        <Row>
          <IconButton icon="chevron-left" label="Previous month" onPress={onPrev} size="sm" />
          <IconButton icon="chevron-right" label="Next month" onPress={onNext} size="sm" />
        </Row>
      </Row>
      <Row>
        {weekdays.map((w) => (
          <Box key={w} equal align="center"><Text variant="caption" tone="subtle">{w}</Text></Box>
        ))}
      </Row>
      {weeks.map((week, i) => (
        <Row key={i}>
          {week.map((c) => (
            <Box key={c.date} equal align="center">
              <Touchable
                onPress={() => onSelect(c.date)}
                label={`${c.date}${c.today ? ", today" : ""}`}
                selected={c.selected}
                hit={false}
                dim="icon-xl"
                radius="full"
                align="center"
                justify="center"
                bg={c.selected ? "accent-solid" : c.today ? "accent-soft" : undefined}
              >
                <Text variant="caption" tone={c.selected ? "on-accent-solid" : c.today ? "on-accent-soft" : c.inMonth ? "default" : "subtle"}>{c.number}</Text>
                {c.marked && !c.selected ? <View accessibilityElementsHidden style={{ position: "absolute", bottom: size.stroke.md, width: size.calendar.dot, height: size.calendar.dot, borderRadius: radius.full, backgroundColor: colors.tones.accent.solid }} /> : null}
              </Touchable>
            </Box>
          ))}
        </Row>
      ))}
    </Box>
  );
}
