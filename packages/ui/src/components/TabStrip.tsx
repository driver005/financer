import { View } from "react-native";

import { size } from "../constants/sizes";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useTheme } from "../theme/ThemeProvider";

export type TabStripItem<K extends string = string> = { key: K; label: string; icon: IconName; /** "2 new" under the name. */ badge?: string };

/**
 * A strip of tabs with an icon and a name each, the chosen one underlined in the accent colour and
 * a small "2 new" under a tab that has something. It is how Gmail sets its Primary, Social and
 * Promotions apart: switching what the list below shows, not moving to another screen.
 */
export function TabStrip<K extends string>({ items, value, onChange }: { items: readonly TabStripItem<K>[]; value: K; onChange: (key: K) => void }) {
  const { colors } = useTheme();
  return (
    <Row accessibilityRole="tablist" align="stretch">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Box key={it.key} equal>
            <Touchable onPress={() => onChange(it.key)} label={it.badge ? `${it.label}, ${it.badge}` : it.label} role="tab" selected={on} hit={false} align="center" gap="2xs" pt="sm" control="lg">
              <Row gap="xs" align="center">
                <Icon name={it.icon} size="md" tone={on ? "accent" : "muted"} />
                <Text variant="label" tone={on ? "accent" : "muted"} numberOfLines={1}>{it.label}</Text>
              </Row>
              {it.badge ? <Text variant="caption" tone={on ? "accent" : "muted"} numberOfLines={1}>{it.badge}</Text> : <Box py="xs" />}
              <View accessibilityElementsHidden style={{ alignSelf: "stretch", height: size.stroke.md, backgroundColor: on ? colors.tones.accent.solid : "transparent" }} />
            </Touchable>
          </Box>
        );
      })}
    </Row>
  );
}
