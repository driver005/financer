import type { ReactNode } from "react";

import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type ListItemProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Replaces the icon (an avatar, a tile in a tone). */
  leading?: ReactNode;
  /** A quiet value on the right ("Weekly", "Off"). */
  value?: string;
  /** Anything on the right: a badge, a switch. */
  trailing?: ReactNode;
  /** A third line under the subtitle ("Next: 18.10.2026"). */
  note?: string;
  /** The icon sits in a small tile, as in the settings. */
  tile?: boolean;
  /** `danger` draws the icon and title in red (a destructive row). */
  tone?: "default" | "danger";
  /** Show the chevron as an open or closed disclosure instead. */
  disclosure?: "open" | "closed";
  /** The accessible name when it differs from the title. */
  label?: string;
  /** The row is a switch or a toggle for assistive technology. */
  role?: "button" | "switch" | "link";
  checked?: boolean;
  onPress?: () => void;
  /** Show a chevron to say it opens something. */
  chevron?: boolean;
  testID?: string;
};

/** A row of a list or of the settings: icon, two lines of text, something on the right. */
export function ListItem({ title, subtitle, icon, leading, value, trailing, note, tile, tone = "default", disclosure, label, role, checked, onPress, chevron, testID }: ListItemProps) {
  const danger = tone === "danger";
  const mark = leading ?? (icon ? (
    tile ? (
      <Box dim="avatar-sm" radius="xl" bg={danger ? "danger-soft" : "sunken"} align="center" justify="center" shrink={false}>
        <Icon name={icon} size="md" tone={danger ? "danger" : "accent"} />
      </Box>
    ) : (
      <Icon name={icon} size="lg" tone={danger ? "danger" : "muted"} />
    )
  ) : null);
  const body = (
    <>
      {mark}
      <Box grow gap="2xs">
        <Text variant={tile ? "bodyStrong" : "body"} tone={danger ? "danger" : "default"} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" numberOfLines={3}>{subtitle}</Text> : null}
        {note ? <Text variant="caption" tone="muted" numberOfLines={2}>{note}</Text> : null}
      </Box>
      {value ? <Box fit shrink><Text variant="label" tone="muted" align="right" numberOfLines={2}>{value}</Text></Box> : null}
      {trailing}
      {disclosure ? <Icon name={disclosure === "open" ? "chevron-up" : "chevron-down"} size="md" tone="muted" /> : chevron || (onPress && !trailing && !role) ? <Icon name="chevron-right" size="md" tone="subtle" /> : null}
    </>
  );
  const look = { direction: "row" as const, align: "center" as const, gap: "md" as const, py: "md" as const, touch: true };
  return onPress ? (
    <Touchable {...look} onPress={onPress} label={label ?? title} role={role} selected={checked} hit={false} testID={testID}>
      {body}
    </Touchable>
  ) : (
    <Row {...look} testID={testID}>
      {body}
    </Row>
  );
}
