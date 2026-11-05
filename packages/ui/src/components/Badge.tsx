import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

export type BadgeProps = { label: string; tone?: Tone; solid?: boolean; icon?: IconName; /** How many lines the words may take (default one). */ lines?: number };

/**
 * A small status label (a pill with a soft fill and text in the dark step). The words carry the meaning; the colour only supports it.
 * The pill is as wide as its words and never grows. A one-line pill keeps its width (it is a short
 * status word); only one that may take several lines shrinks and wraps when the row is short. It
 * used to carry a 100 % maximum width and a growing label; on Android that pill spread over the whole
 * row next to a growing title and left the title no width.
 */
export function Badge({ label, tone = "neutral", solid, icon, lines = 1 }: BadgeProps) {
  const text = solid ? (`on-${tone}-solid` as const) : (`on-${tone}-soft` as const);
  return (
    <Row bg={solid ? `${tone}-solid` : `${tone}-soft`} radius="full" px="sm" py="2xs" gap="xs" align="center" shrink={lines > 1}>
      {icon ? <Icon name={icon} size="xs" tone={text} /> : null}
      <Box shrink>
        <Text variant="caption" tone={text} numberOfLines={lines}>
          {label}
        </Text>
      </Box>
    </Row>
  );
}
