import type { ReactNode } from "react";

import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type ListItemProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Anything on the right: a value, a badge, a switch. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Show a chevron to say it opens something. */
  chevron?: boolean;
  testID?: string;
};

/** A row of a list or of the settings: icon, two lines of text, something on the right. */
export function ListItem({ title, subtitle, icon, trailing, onPress, chevron, testID }: ListItemProps) {
  const body = (
    <>
      {icon ? <Icon name={icon} size="lg" tone="muted" /> : null}
      <Box grow gap="2xs">
        <Text variant="body" numberOfLines={2}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" numberOfLines={3}>{subtitle}</Text> : null}
      </Box>
      {trailing}
      {chevron || (onPress && !trailing) ? <Icon name="chevron-right" size="md" tone="subtle" /> : null}
    </>
  );
  const look = { direction: "row" as const, align: "center" as const, gap: "md" as const, py: "md" as const, touch: true };
  return onPress ? (
    <Touchable {...look} onPress={onPress} label={title} hit={false} testID={testID}>
      {body}
    </Touchable>
  ) : (
    <Row {...look} testID={testID}>
      {body}
    </Row>
  );
}
