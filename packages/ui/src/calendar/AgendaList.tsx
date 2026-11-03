import { View } from "react-native";

import { size } from "../constants/sizes";
import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useTheme } from "../theme/ThemeProvider";
import type { AgendaDay } from "./types";

/**
 * The schedule view: day by day, each event a row with its time range, title and place. Days with
 * nothing are left out by the screen. Today's heading is in the accent colour.
 */
export function AgendaList({ days, empty }: { days: AgendaDay[]; empty?: string }) {
  const { colors } = useTheme();
  if (days.length === 0) {
    return (
      <Box p="xl" align="center">
        <Text tone="muted">{empty ?? "Nothing planned."}</Text>
      </Box>
    );
  }
  return (
    <Box gap="lg">
      {days.map((d) => (
        <Box key={d.date} gap="xs">
          {d.heading ? <Text variant="bodyStrong" tone={d.today ? "accent" : "default"}>{d.heading}</Text> : null}
          {d.items.map((it) => (
            <Touchable key={it.key} onPress={it.onPress} disabled={!it.onPress} label={`${it.title}, ${it.range}`} hit={false} bg="surface" radius="xl" overflow="hidden" direction="row" align="stretch" shadow="surface">
              <View accessibilityElementsHidden style={{ width: size.stroke.md, backgroundColor: colors.tones[it.tone].solid }} />
              <Box grow p="md" gap="2xs">
                <Box direction="row" justify="between" gap="md">
                  <Box grow><Text variant="bodyStrong" numberOfLines={1}>{it.title}</Text></Box>
                  <Text variant="caption" tone="muted">{it.range}</Text>
                </Box>
                {it.subtitle ? <Text variant="caption" tone="muted" numberOfLines={1}>{it.subtitle}</Text> : null}
              </Box>
            </Touchable>
          ))}
        </Box>
      ))}
    </Box>
  );
}
