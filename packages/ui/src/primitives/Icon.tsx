import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import { type IconSize, size } from "../constants/sizes";
import { type TextTone, useTextColor } from "./Text";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** A Material Community icon at a token size, in a text tone. Decorative unless it has a label. */
export function Icon({ name, size: s = "md", tone = "default", label }: { name: IconName; size?: IconSize; tone?: TextTone; label?: string }) {
  const color = useTextColor()(tone);
  return (
    <MaterialCommunityIcons
      name={name}
      size={size.icon[s]}
      color={color}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      accessibilityLabel={label}
    />
  );
}
