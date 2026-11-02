import { View } from "react-native";

import { borderWidth } from "../constants/radius";
import { useTheme } from "../theme/ThemeProvider";

/** A hairline between things. Prefer spacing; use this where a list needs it. */
export function Divider({ vertical }: { vertical?: boolean }) {
  const { colors } = useTheme();
  return <View accessibilityRole="none" style={vertical ? { width: borderWidth.hairline, alignSelf: "stretch", backgroundColor: colors.border.default } : { height: borderWidth.hairline, alignSelf: "stretch", backgroundColor: colors.border.default }} />;
}
