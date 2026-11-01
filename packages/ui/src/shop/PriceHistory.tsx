import { Sparkline } from "../components/Sparkline";
import { Card } from "../components/Card";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { formatCents } from "../format";
import { Stat } from "./PriceTag";

/** The recorded prices as a line, with the low, the high and what it is now. */
export function PriceHistory({ cents, perMonth }: { cents: readonly number[]; perMonth?: boolean }) {
  if (cents.length < 2) {
    return (
      <Card variant="flat">
        <Text variant="body" tone="muted">Not enough price history yet. It builds up with every look at the shops.</Text>
      </Card>
    );
  }
  const lo = Math.min(...cents);
  const hi = Math.max(...cents);
  const now = cents[cents.length - 1];
  const unit = perMonth ? " / month" : "";
  return (
    <Card variant="outline">
      <Sparkline values={[...cents]} tone={now <= lo ? "success" : "accent"} />
      <Row justify="between">
        <Stat label="Lowest" value={`${formatCents(lo)}${unit}`} tone="success" />
        <Stat label="Now" value={`${formatCents(now)}${unit}`} />
        <Stat label="Highest" value={`${formatCents(hi)}${unit}`} />
      </Row>
      <Box><Text variant="caption" tone="subtle">{cents.length} recorded prices</Text></Box>
    </Card>
  );
}
