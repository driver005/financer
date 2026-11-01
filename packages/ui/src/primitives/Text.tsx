import type { ReactNode } from "react";
import { Platform, Text as RNText, type TextStyle } from "react-native";

import type { Tone } from "../constants/colors";
import { fontFamilyWeb, fontSize, fontWeight, letterSpacing, lineHeight, textVariants, type TextVariant } from "../constants/typography";
import { useTheme } from "../theme/ThemeProvider";
import type { Mutable } from "./box";

/** Text colours: the plain roles, a tone on the surface, or the text that goes on a tone's solid or soft fill. */
export type TextTone = "default" | "muted" | "subtle" | "inverse" | Tone | `on-${Tone}-solid` | `on-${Tone}-soft`;

export type TextProps = {
  children?: ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  align?: "left" | "center" | "right";
  numberOfLines?: number;
  /** Cross out (the old price). */
  strike?: boolean;
  /** Heading level for assistive technology and the web (1 to 6). */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  selectable?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

export function useTextColor() {
  const { colors } = useTheme();
  return (tone: TextTone): string => {
    if (tone === "default" || tone === "muted" || tone === "subtle" || tone === "inverse") return colors.text[tone];
    if (tone.startsWith("on-")) {
      const [, t, kind] = tone.split("-") as [string, Tone, "solid" | "soft"];
      return kind === "solid" ? colors.tones[t].onSolid : colors.tones[t].onSoft;
    }
    return colors.tones[tone as Tone].text;
  };
}

export function Text({ children, variant = "body", tone = "default", align, numberOfLines, strike, level, selectable, testID, accessibilityLabel }: TextProps) {
  const color = useTextColor()(tone);
  const v = textVariants[variant];
  const style: Mutable<TextStyle> = {
    color,
    fontSize: fontSize[v.size],
    lineHeight: lineHeight[v.size],
    fontWeight: fontWeight[v.weight],
    letterSpacing: letterSpacing[v.tracking] * fontSize[v.size],
  };
  if ("tabular" in v && v.tabular) style.fontVariant = ["tabular-nums"];
  if (Platform.OS === "web") style.fontFamily = fontFamilyWeb;
  if (align) style.textAlign = align;
  if (strike) style.textDecorationLine = "line-through";
  return (
    <RNText
      style={style}
      numberOfLines={numberOfLines}
      selectable={selectable}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={level ? "header" : undefined}
      aria-level={level}
    >
      {children}
    </RNText>
  );
}
