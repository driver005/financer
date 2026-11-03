import { Box, Row } from "../primitives/Box";
import { Dot } from "../primitives/Dot";
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
          <Text variant="bodyStrong" tone={d.today ? "accent" : "default"}>{d.heading}</Text>
          {d.items.map((it) => (
            <Touchable key={it.key} onPress={it.onPress} disabled={!it.onPress} label={`${it.title}, ${it.range}`} hit={false} bg="surface" radius="xl" p="md" direction="row" gap="md" align="center">
              <Dot color={colors.tones[it.tone].solid} />
              <Box grow>
                <Text variant="bodyStrong" numberOfLines={1}>{it.title}</Text>
                {it.subtitle ? <Text variant="caption" tone="muted" numberOfLines={1}>{it.subtitle}</Text> : null}
              </Box>
              <Row>
                <Text variant="caption" tone="muted">{it.range}</Text>
              </Row>
            </Touchable>
          ))}
        </Box>
      ))}
    </Box>
  );
}
