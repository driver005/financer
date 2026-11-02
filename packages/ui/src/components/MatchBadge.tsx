import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { toneForScore } from "./Meter";

/** The match score as a small pill: a coloured dot, the number and the word "Match". The dot's colour supports the number. */
export function MatchBadge({ score }: { score: number }) {
  const tone = toneForScore(score / 100);
  return (
    <Row bg="sunken" radius="full" px="md" py="2xs" gap="xs" align="center" accessibilityLabel={`Match ${Math.round(score)} of 100`}>
      <Box dim="icon-xs" radius="full" bg={`${tone}-solid`} />
      <Text variant="number">{Math.round(score)}</Text>
      <Text variant="caption" tone="muted">Match</Text>
    </Row>
  );
}
