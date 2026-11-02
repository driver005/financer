import { Meter } from "../components/Meter";
import { Card } from "../components/Card";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";

export type SavingsBarProps = {
  title: string;
  /** The big number: "8,00 € a month". */
  amount: string;
  /** What it is a share of, 0 to 1, drawn as the bar. */
  share: number;
  /** The words under the bar: "27 % of what you pay now". */
  caption: string;
  /** Another line: "192,00 € over 24 months". */
  detail?: string;
};

/** What switching would save, as a number and a bar against what you pay now. */
export function SavingsBar({ title, amount, share, caption, detail }: SavingsBarProps) {
  return (
    <Card tone="success" gap="sm">
      <Text variant="label" tone="on-success-soft">{title}</Text>
      <Row align="baseline" gap="sm" wrap>
        <Text variant="priceLarge" tone="on-success-soft">{amount}</Text>
        {detail ? <Text variant="body" tone="on-success-soft">{detail}</Text> : null}
      </Row>
      <Meter value={share} tone="success" thickness="md" label={caption} />
      <Box><Text variant="caption" tone="on-success-soft">{caption}</Text></Box>
    </Card>
  );
}
