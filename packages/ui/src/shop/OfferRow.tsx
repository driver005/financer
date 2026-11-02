import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { PriceTag } from "./PriceTag";

export type OfferRowProps = {
  shop: string;
  priceCents: number;
  perMonth?: boolean;
  wasCents?: number | null;
  /** A line of terms: contract length, shipping, "seen 2 days ago". */
  detail?: string;
  inStock?: boolean;
  best?: boolean;
  onOpen?: () => void;
};

/** One shop's offer for a product. */
export function OfferRow({ shop, priceCents, perMonth, wasCents, detail, inStock = true, best, onOpen }: OfferRowProps) {
  return (
    <Row gap="md" py="md" align="center">
      <Box grow gap="2xs">
        <Row gap="sm" wrap>
          <Text variant="bodyStrong">{shop}</Text>
          {best ? <Badge label="Best price" tone="success" /> : null}
          {!inStock ? <Badge label="Out of stock" tone="danger" /> : null}
        </Row>
        {detail ? <Text variant="caption" tone="muted">{detail}</Text> : null}
      </Box>
      <PriceTag cents={priceCents} perMonth={perMonth} wasCents={wasCents} />
      {onOpen ? <Button label="Open" variant="soft" size="sm" onPress={onOpen} /> : null}
    </Row>
  );
}
