import type { Tone } from "../constants/colors";
import { Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

/**
 * A big filter pill as the finance apps draw them (All, Income, Expenses): the chosen one filled in the
 * tone with light text, the others only outlined. It is wider and taller than a `Chip`, has no check
 * mark (the fill says which one is on) and is meant for the one row of filters under a screen's title.
 */
export function Pill({ label, selected, onPress, tone = "success", testID }: { label: string; selected?: boolean; onPress: () => void; tone?: Tone; testID?: string }) {
  return (
    <Touchable
      onPress={onPress}
      label={label}
      role="tab"
      selected={selected}
      hit={false}
      direction="row"
      align="center"
      justify="center"
      px="xl"
      control="md"
      radius="full"
      bg={selected ? `${tone}-solid` : undefined}
      border={selected ? undefined : "hairline"}
      borderTone="strong"
      testID={testID}
    >
      <Text variant="control" tone={selected ? `on-${tone}-solid` : "default"} numberOfLines={1}>{label}</Text>
    </Touchable>
  );
}

/** The row the pills stand in. */
export function PillRow({ children }: { children: React.ReactNode }) {
  return (
    <Row gap="sm" wrap accessibilityRole="tablist">
      {children}
    </Row>
  );
}
