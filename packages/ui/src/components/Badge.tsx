import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

export type BadgeProps = { label: string; tone?: Tone; solid?: boolean; icon?: IconName; /** How many lines the words may take (default one). */ lines?: number };

/** A small status label (a pill with a soft fill and text in the dark step). The words carry the meaning; the colour only supports it. */
export function Badge({ label, tone = "neutral", solid, icon, lines = 1 }: BadgeProps) {
  const text = solid ? (`on-${tone}-solid` as const) : (`on-${tone}-soft` as const);
  return (
    <Row bg={solid ? `${tone}-solid` : `${tone}-soft`} radius="full" px="sm" py="2xs" gap="xs" align="center" fit>
      {icon ? <Icon name={icon} size="xs" tone={text} /> : null}
      <Box grow>
        <Text variant="caption" tone={text} numberOfLines={lines}>
          {label}
        </Text>
      </Box>
    </Row>
  );
}
