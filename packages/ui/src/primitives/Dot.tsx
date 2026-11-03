import { View } from "react-native";

import { radius } from "../constants/radius";
import { size } from "../constants/sizes";

/** A small round mark in a colour that came from the theme (a chart key, a legend). */
export function Dot({ color }: { color: string }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size.icon.xs, height: size.icon.xs, borderRadius: radius.full, backgroundColor: color }} />;
}
