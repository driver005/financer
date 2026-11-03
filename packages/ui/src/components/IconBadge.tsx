import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

/** A round tile with an icon or one or two letters in a tone's soft fill (a category, a store, a person). */
export function IconBadge({ icon, text, tone = "accent", square }: { icon?: IconName; text?: string; tone?: Tone; square?: boolean }) {
  return (
    <Box dim="avatar-md" bg={`${tone}-soft`} radius={square ? "xl" : "full"} align="center" justify="center" shrink={false}>
      {icon ? <Icon name={icon} size="md" tone={`on-${tone}-soft`} /> : <Text variant="label" tone={`on-${tone}-soft`}>{text}</Text>}
    </Box>
  );
}
