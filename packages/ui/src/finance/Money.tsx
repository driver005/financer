import type { TextVariant } from "../constants/typography";
import { formatMoney, spokenMoney } from "../format";
import { Text, type TextTone } from "../primitives/Text";

export type MoneyTone = "auto" | "plain" | "good" | "bad" | "muted";

const TONE: Record<Exclude<MoneyTone, "auto">, TextTone> = { plain: "default", good: "success", bad: "danger", muted: "muted" };

/**
 * An amount in euros, set the same way everywhere: German notation, a real minus sign, tabular
 * numerals and one line that never wraps. `auto` colours income green and leaves spending in the
 * normal text colour (a screen full of red is noise); `signed` adds a `+` to income.
 */
export function Money({ cents, variant = "number", tone = "auto", signed, label }: { cents: number; variant?: TextVariant; tone?: MoneyTone; signed?: boolean; label?: string }) {
  const colour: TextTone = tone === "auto" ? (cents > 0 ? "success" : "default") : TONE[tone];
  return (
    <Text variant={variant} tone={colour} numberOfLines={1} accessibilityLabel={label ?? spokenMoney(cents)}>
      {formatMoney(cents, { signed })}
    </Text>
  );
}
