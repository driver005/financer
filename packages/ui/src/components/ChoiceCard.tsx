import type { ReactNode } from "react";

import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

/** A big tappable answer: a titled card with an icon tile, that gets the accent border when chosen. */
export function ChoiceCard({ title, body, icon, selected, onPress, disabled, note, role = "radio", children }: { title: string; body?: string; icon: IconName; selected: boolean; onPress: () => void; disabled?: boolean; note?: string; role?: "radio" | "checkbox"; children?: ReactNode }) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      label={title}
      role={role}
      selected={selected}
      bg={selected ? "accent-soft" : "surface"}
      radius="3xl"
      border="thick"
      borderTone={selected ? "accent" : "clear"}
      shadow={selected ? undefined : "surface"}
      p="lg"
      direction="row"
      gap="md"
      align="start"
    >
      <Box dim="avatar-md" radius="xl" bg={selected ? "accent-solid" : "sunken"} align="center" justify="center" shrink={false}>
        <Icon name={icon} size="lg" tone={selected ? "on-accent-solid" : "accent"} />
      </Box>
      <Box grow gap="xs">
        <Text variant="bodyStrong" tone={selected ? "on-accent-soft" : "default"}>{title}</Text>
        {body ? <Text variant="label" tone={selected ? "on-accent-soft" : "muted"}>{body}</Text> : null}
        {note ? <Text variant="caption" tone={selected ? "on-accent-soft" : "muted"}>{note}</Text> : null}
        {children}
      </Box>
      <Icon name={role === "radio" ? (selected ? "radiobox-marked" : "radiobox-blank") : selected ? "checkbox-marked" : "checkbox-blank-outline"} size="lg" tone={selected ? "on-accent-soft" : "subtle"} />
    </Touchable>
  );
}
