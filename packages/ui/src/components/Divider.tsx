import { View } from "react-native";

import { borderWidth } from "../constants/radius";
import { Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

/** A hairline between things. Prefer spacing; use this where a list needs it. */
export function Divider({ vertical }: { vertical?: boolean }) {
  const { colors } = useTheme();
  return <View accessibilityRole="none" style={vertical ? { width: borderWidth.hairline, alignSelf: "stretch", backgroundColor: colors.border.default } : { height: borderWidth.hairline, alignSelf: "stretch", backgroundColor: colors.border.default }} />;
}

/** A hairline with words in the middle: the day in a chat, a topic that starts. */
export function DividerLabel({ label }: { label: string }) {
  const { colors } = useTheme();
  const line = { flex: 1, height: borderWidth.hairline, backgroundColor: colors.border.default };
  return (
    <Row gap="md" accessibilityRole="header" accessibilityLabel={label}>
      <View style={line} />
      <Text variant="caption" tone="muted">{label}</Text>
      <View style={line} />
    </Row>
  );
}
