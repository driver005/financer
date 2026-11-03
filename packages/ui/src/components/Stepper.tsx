import { Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { IconButton } from "./Button";

/** A quantity with a minus and a plus button. At one, the minus can read as "remove". */
export function Stepper({ value, onMinus, onPlus, minusLabel, plusLabel, remove, unit }: { value: number; unit?: string; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; remove?: boolean }) {
  return (
    <Row gap="xs">
      <IconButton icon={remove ? "delete-outline" : "minus"} label={minusLabel} onPress={onMinus} variant="secondary" size="sm" />
      <Text variant="bodyStrong" align="center" accessibilityLabel={unit ? `${value} ${unit}` : `${value}`}>{unit ? `${value} ${unit}` : value}</Text>
      <IconButton icon="plus" label={plusLabel} onPress={onPlus} variant="secondary" size="sm" />
    </Row>
  );
}
