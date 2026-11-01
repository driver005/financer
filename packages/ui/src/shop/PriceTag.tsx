import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { formatCents } from "../format";

export type PriceTagProps = {
  cents: number | null | undefined;
  /** A monthly price (plans): shows `/ month` after it. */
  perMonth?: boolean;
  /** The price it was (struck through). */
  wasCents?: number | null;
  size?: "md" | "lg";
};

/** A price, large and in tabular figures, with the old price beside it when it came down. */
export function PriceTag({ cents, perMonth, wasCents, size: s = "md" }: PriceTagProps) {
  if (cents === null || cents === undefined) return <Text variant="label" tone="subtle">No price</Text>;
  return (
    <Row gap="sm" align="baseline" wrap>
      <Text variant={s === "lg" ? "priceLarge" : "price"} numberOfLines={1}>{formatCents(cents)}</Text>
      {perMonth ? <Text variant="caption" tone="muted">/ month</Text> : null}
      {wasCents && wasCents > cents ? <Text variant="caption" tone="subtle" strike>{formatCents(wasCents)}</Text> : null}
    </Row>
  );
}

/** A label above a value (the lowest price, the shop). */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "default" }) {
  return (
    <Box gap="2xs">
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="number" tone={tone === "default" || !tone ? "default" : tone}>{value}</Text>
    </Box>
  );
}
