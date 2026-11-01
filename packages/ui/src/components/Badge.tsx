import type { Tone } from "../constants/colors";
import { Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

export type BadgeProps = { label: string; tone?: Tone; solid?: boolean; icon?: IconName };

/** A small status label. The words carry the meaning; the colour only supports it. */
export function Badge({ label, tone = "neutral", solid, icon }: BadgeProps) {
  const text = solid ? (`on-${tone}-solid` as const) : (`on-${tone}-soft` as const);
  return (
    <Row bg={solid ? `${tone}-solid` : `${tone}-soft`} radius="full" px="sm" py="2xs" gap="xs" align="center">
      {icon ? <Icon name={icon} size="xs" tone={text} /> : null}
      <Text variant="caption" tone={text} numberOfLines={1}>
        {label}
      </Text>
    </Row>
  );
}
