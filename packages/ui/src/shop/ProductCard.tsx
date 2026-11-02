import type { Tone } from "../constants/colors";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { Button, IconButton } from "../components/Button";
import { Chip } from "../components/Chip";
import { MatchBadge } from "../components/MatchBadge";
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
  /** The score as a ring (default) or as a "96 Match" pill. */
  scoreAs?: "ring" | "badge";
  /** Price class: budget, mid-range, flagship. */
  tier?: string | null;
  badges?: ProductBadge[];
  /** The reason in a few words: what it is good at. */
  strengths?: string[];
  weaknesses?: string[];
  /** A saving against what you pay now, already worded. */
  note?: string | null;
  /** What it won ("Best overall · Best value"): a badge on a top row, with the match pill on the right. */
  heading?: string | null;
  /** Strengths as chips (for the picks) or as plain "+ ..." lines (the default, for dense grids). */
  strengthsAs?: "lines" | "chips";
  /** A primary button at the foot of the card ("View deal") that goes to the shop. */
  onOpen?: () => void;
  openLabel?: string;
  /** A bell on the card: tell me when the price drops. */
  onWatch?: () => void;
  /** `grid`: picture on top, for the product grid. `row`: picture on the left, for lists. */
  layout?: "grid" | "row";
  selected?: boolean;
  onToggleCompare?: () => void;
  onPress?: () => void;
  testID?: string;
};

/** One product in a list or grid: picture, name, price, score and the reason it ranks where it does. */
export function ProductCard({
  title, brand, imageUri, priceCents, perMonth, wasCents, shop, score, scoreAs = "ring", tier, badges = [], strengths = [], weaknesses = [], note, heading, strengthsAs = "lines", onOpen, openLabel = "View deal", onWatch, layout = "grid",
  selected, onToggleCompare, onPress, testID,
}: ProductCardProps) {
  const matchPill = typeof score === "number" && scoreAs === "badge" ? <MatchBadge score={score} /> : null;
  const topRow =
    heading || matchPill ? (
      <Row justify="between" gap="sm" align="center">
        <Box grow>{heading ? <Row><Badge label={heading} tone="success" icon="check-decagram-outline" lines={2} /></Row> : null}</Box>
        {matchPill}
      </Row>
    ) : null;
  const text = (
    <Box gap="sm" grow>
      {note ? <Row><Badge label={note} tone="success" icon="trending-down" lines={2} /></Row> : null}
      <Row gap="sm" align="start" justify="between">
        <Box grow gap="2xs">
          {brand ? <Text variant="caption" tone="muted" numberOfLines={1}>{brand}</Text> : null}
          <Text variant="bodyStrong" numberOfLines={2}>{title}</Text>
        </Box>
        {typeof score === "number" && scoreAs === "ring" ? <ScoreRing score={score} size="sm" /> : null}
        {onWatch ? <IconButton icon="bell-plus-outline" label="Tell me about price drops" size="sm" onPress={onWatch} /> : null}
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
      {strengths.length > 0 && strengthsAs === "chips" ? (
        <Row wrap gap="xs">{strengths.slice(0, 4).map((x) => <Chip key={x} label={x} icon="check" />)}</Row>
      ) : null}
      {strengths.length > 0 && strengthsAs === "lines" ? <Text variant="caption" tone="success" numberOfLines={2}>+ {strengths.join(", ")}</Text> : null}
      {weaknesses.length > 0 && strengthsAs === "lines" ? <Text variant="caption" tone="danger" numberOfLines={2}>− {weaknesses.join(", ")}</Text> : null}
      <Box grow />
      {onToggleCompare ? (
        <Row>
          <Chip label={selected ? "Added to compare" : "Compare"} icon={selected ? "check" : "plus"} selected={selected} onPress={onToggleCompare} />
        </Row>
      ) : null}
    </Box>
  );
  const open = onOpen ? <Button label={openLabel} icon="open-in-new" full onPress={onOpen} /> : null;
  return (
    <Card variant="raised" fill padded={false} selected={selected} onPress={onPress} label={title} testID={testID} gap="none">
      {layout === "grid" ? (
        <Box gap="none">
          <Thumbnail uri={imageUri} fill radius="none" label={title} />
          <Box p="md" gap="sm">{topRow}{text}{open}</Box>
        </Box>
      ) : (
        <Box p="md" gap="md">
          {topRow}
          <Row gap="md" align="start">
            <Thumbnail uri={imageUri} dim="thumb-md" label={title} />
            {text}
          </Row>
          {open}
        </Box>
      )}
    </Card>
  );
}
