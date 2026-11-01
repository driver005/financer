import type { Tone } from "../constants/colors";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { ScoreRing } from "../components/ScoreRing";
import { Thumbnail } from "../components/Thumbnail";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { PriceTag } from "./PriceTag";

export type ProductBadge = { label: string; tone?: Tone };

export type ProductCardProps = {
  title: string;
  brand?: string | null;
  imageUri?: string | null;
  priceCents: number | null;
  perMonth?: boolean;
  wasCents?: number | null;
  shop?: string | null;
  /** 0 to 100. */
  score?: number | null;
  /** Price class: budget, mid-range, flagship. */
  tier?: string | null;
  badges?: ProductBadge[];
  /** The reason in a few words: what it is good at. */
  strengths?: string[];
  weaknesses?: string[];
  /** A saving against what you pay now, already worded. */
  note?: string | null;
  /** `grid`: picture on top, for the product grid. `row`: picture on the left, for lists. */
  layout?: "grid" | "row";
  selected?: boolean;
  onToggleCompare?: () => void;
  onPress?: () => void;
  testID?: string;
};

/** One product in a list or grid: picture, name, price, score and the reason it ranks where it does. */
export function ProductCard({
  title, brand, imageUri, priceCents, perMonth, wasCents, shop, score, tier, badges = [], strengths = [], weaknesses = [], note, layout = "grid",
  selected, onToggleCompare, onPress, testID,
}: ProductCardProps) {
  const text = (
    <Box gap="sm" grow>
      <Row gap="sm" align="start" justify="between">
        <Box grow gap="2xs">
          {brand ? <Text variant="caption" tone="muted" numberOfLines={1}>{brand}</Text> : null}
          <Text variant="bodyStrong" numberOfLines={2}>{title}</Text>
        </Box>
        {typeof score === "number" ? <ScoreRing score={score} size="sm" /> : null}
      </Row>
      <Box gap="2xs">
        <PriceTag cents={priceCents} perMonth={perMonth} wasCents={wasCents} />
        {shop ? <Text variant="caption" tone="muted" numberOfLines={1}>{shop}</Text> : null}
      </Box>
      {tier || badges.length > 0 ? (
        <Row wrap gap="xs">
          {tier ? <Badge label={tier} /> : null}
          {badges.map((b) => <Badge key={b.label} label={b.label} tone={b.tone ?? "success"} />)}
        </Row>
      ) : null}
      {strengths.length > 0 ? <Text variant="caption" tone="success" numberOfLines={2}>+ {strengths.join(", ")}</Text> : null}
      {weaknesses.length > 0 ? <Text variant="caption" tone="danger" numberOfLines={2}>− {weaknesses.join(", ")}</Text> : null}
      {note ? <Text variant="caption" tone="success">{note}</Text> : null}
      <Box grow />
      {onToggleCompare ? (
        <Row>
          <Chip label={selected ? "Added to compare" : "Compare"} icon={selected ? "check" : "plus"} selected={selected} onPress={onToggleCompare} />
        </Row>
      ) : null}
    </Box>
  );
  return (
    <Card variant="raised" padded={false} selected={selected} onPress={onPress} label={title} testID={testID} gap="none">
      {layout === "grid" ? (
        <Box gap="none">
          <Thumbnail uri={imageUri} fill radius="none" label={title} />
          <Box p="md">{text}</Box>
        </Box>
      ) : (
        <Row gap="md" p="md" align="start">
          <Thumbnail uri={imageUri} dim="thumb-md" label={title} />
          {text}
        </Row>
      )}
    </Card>
  );
}
