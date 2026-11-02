import { Box } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

/** A tick box with its label; the whole row is the target. */
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Touchable onPress={() => onChange(!checked)} label={label} role="checkbox" selected={checked} direction="row" align="center" gap="md" touch hit={false}>
      <Box
        dim="icon-md"
        radius="md"
        border="thick"
        borderTone={checked ? "accent" : "strong"}
        bg={checked ? "accent-solid" : "surface"}
        align="center"
        justify="center"
      >
        {checked ? <Icon name="check" size="xs" tone="on-accent-solid" /> : null}
      </Box>
      <Text variant="body">{label}</Text>
    </Touchable>
  );
}
