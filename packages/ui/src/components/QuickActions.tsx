import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type QuickAction = { icon: IconName; label: string; onPress: () => void; disabled?: boolean };

/**
 * A row of round buttons with their name under them (Send, Request, Top up): the few things you do
 * most from a screen, one tap away and readable at a glance. Each tile shares the width equally.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <Row gap="md" align="start" justify="center">
      {actions.map((a) => (
        <Box key={a.label} equal align="center" gap="xs">
          <Touchable onPress={a.onPress} label={a.label} disabled={a.disabled} bg="sunken" radius="full" dim="avatar-lg" align="center" justify="center" hit={false}>
            <Icon name={a.icon} size="lg" tone={a.disabled ? "subtle" : "accent"} />
          </Touchable>
          <Text variant="label" align="center" numberOfLines={1}>{a.label}</Text>
        </Box>
      ))}
    </Row>
  );
}
