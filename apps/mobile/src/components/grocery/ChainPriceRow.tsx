import { Badge, Box, IconBadge, Row, Text } from "@financer/ui";

import { chainTone, initials } from "@/groceryView";
import { chainLabel } from "@/hooks";

/**
 * One chain in a price comparison: avatar, name, what the price is for, and the price on the
 * right. The cheapest chain is tinted and carries a badge; the others show how much more they cost.
 */
export function ChainPriceRow({
  chain,
  detail,
  priceText,
  extraText,
  isCheapest,
  isOffer,
  note,
  accessibilityLabel,
}: {
  chain: string;
  /** Product name or pack line under the chain name. */
  detail?: string;
  priceText: string;
  /** `+0,06 €` for a dearer chain. */
  extraText?: string;
  isCheapest?: boolean;
  isOffer?: boolean;
  /** Smaller line at the bottom (validity, source). */
  note?: string;
  accessibilityLabel: string;
}) {
  const name = chainLabel(chain);
  return (
    <Row bg={isCheapest ? "success-soft" : "sunken"} radius="2xl" p="md" gap="md" accessible accessibilityLabel={accessibilityLabel}>
      <IconBadge tone={chainTone(chain)} text={initials(name)} />
      <Box grow gap="2xs">
        <Row gap="sm" wrap>
          <Text variant="bodyStrong">{name}</Text>
          {isCheapest ? <Badge tone="success" label="Cheapest" icon="star" /> : null}
          {isOffer ? <Badge tone="warning" label="Offer" icon="tag" /> : null}
        </Row>
        {detail ? <Text variant="caption" tone="muted" numberOfLines={2}>{detail}</Text> : null}
        {note ? (
          <Text variant="caption" tone="muted">{note}</Text>
        ) : null}
      </Box>
      <Box align="end">
        <Text variant="price" tone={isCheapest ? "on-success-soft" : "default"}>{priceText}</Text>
        {extraText ? <Text variant="caption" tone="muted">{extraText}</Text> : null}
      </Box>
    </Row>
  );
}
