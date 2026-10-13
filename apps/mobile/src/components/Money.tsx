import { Text as RNText, type StyleProp, type TextStyle } from "react-native";

import { formatMoney, moneyTone, spokenMoney } from "@/format";
import { tabular, typography, usePalette, type TypeName } from "@/theme";

/**
 * An amount in euros, set the same way everywhere: German notation, real minus sign, tabular
 * numerals, a non-breaking space before the euro sign and no clipping (one line, never wraps; the
 * parent lets it keep its width).
 *
 * `tone`: `auto` colours income green and leaves expenses in the normal text colour (a screen full
 * of red is noise); `plain` never colours; `bad`/`good`/`muted` force a colour. `signed` adds a
 * `+` to income, for lists that mix income and spending.
 */
export function Money({
  cents,
  variant = "body",
  tone = "auto",
  signed,
  bold,
  style,
  label,
}: {
  cents: number;
  variant?: Extract<TypeName, "display" | "heading" | "body" | "bodyStrong" | "label" | "caption">;
  tone?: "auto" | "plain" | "good" | "bad" | "muted";
  signed?: boolean;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  /** Screen reader text; default is the spoken amount, e.g. `minus 23,47 euros`. */
  label?: string;
}) {
  const p = usePalette();
  const colour =
    tone === "plain"
      ? p.text
      : tone === "good"
        ? p.good
        : tone === "bad"
          ? p.bad
          : tone === "muted"
            ? p.muted
            : moneyTone(cents) === "income"
              ? p.good
              : p.text;
  return (
    <RNText
      accessibilityLabel={label ?? spokenMoney(cents)}
      numberOfLines={1}
      maxFontSizeMultiplier={variant === "display" ? 1.2 : 1.5}
      style={[typography[variant], tabular, { color: colour, flexShrink: 0 }, bold ? { fontWeight: "800" } : null, style]}
    >
      {formatMoney(cents, { signed })}
    </RNText>
  );
}
