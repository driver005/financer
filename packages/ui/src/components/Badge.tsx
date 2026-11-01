import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

export type BadgeProps = { label: string; tone?: Tone; solid?: boolean; icon?: IconName };

/** A small status label: a capitals pill with a soft fill and a line, or a solid one. The words carry the meaning; the colour only supports it. */
export function Badge({ label, tone = "neutral", solid, icon }: BadgeProps) {
  const text = solid ? (`on-${tone}-solid` as const) : (`on-${tone}-soft` as const);
  return (
    <Row bg={solid ? `${tone}-solid` : `${tone}-soft`} radius="full" px="md" py="xs" border={solid ? undefined : "thick"} borderTone={tone} gap="xs" align="center" fit>
      {icon ? <Icon name={icon} size="xs" tone={text} /> : null}
      <Box grow>
        <Text variant="badge" tone={text} numberOfLines={1}>
          {label}
        </Text>
      </Box>
    </Row>
  );
}
