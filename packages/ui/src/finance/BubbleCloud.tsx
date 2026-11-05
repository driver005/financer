import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { bubbleDim } from "./geometry";

export type Bubble = { key: string; label: string; share: number; icon: IconName; tone: Tone; /** Written under the name ("604,36 €"). */ value?: string };

/**
 * Where something went, as bubbles: the bigger the share the bigger the bubble, each with its icon
 * and, once it is large enough, its percentage. Every bubble is named under it, with its amount, so
 * nothing depends on judging sizes or telling hues apart; `summary` is the same said in one sentence
 * for a screen reader.
 */
export function BubbleCloud({ bubbles, summary }: { bubbles: Bubble[]; summary: string }) {
  return (
    <Row gap="lg" wrap justify="center" align="end" accessible accessibilityRole="image" accessibilityLabel={summary}>
      {bubbles.map((b) => {
        const dim = bubbleDim(b.share);
        const big = dim === "ring-lg" || dim === "avatar-xl";
        return (
          <Box key={b.key} align="center" gap="xs">
            <Box dim={dim} radius="full" bg={`${b.tone}-soft`} align="center" justify="center" shrink={false}>
              <Icon name={b.icon} size={big ? "lg" : "md"} tone={`on-${b.tone}-soft`} />
              {big ? <Text variant="number" tone={`on-${b.tone}-soft`}>{`${Math.round(b.share * 100)} %`}</Text> : null}
            </Box>
            <Text variant="label" numberOfLines={1}>{b.label}</Text>
            {b.value ? <Text variant="caption" tone="muted" numberOfLines={1}>{b.value}</Text> : null}
          </Box>
        );
      })}
    </Row>
  );
}
