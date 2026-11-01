import { Box } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type Option<T extends string> = { value: T; label: string; description?: string };

/** A list where exactly one option is chosen (sorting, language). */
export function OptionList<T extends string>({ options, value, onChange }: { options: readonly Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <Box gap="sm" accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable key={o.value} onPress={() => onChange(o.value)} label={o.label} role="radio" selected={on} direction="row" align="center" gap="md" px="lg" py="sm" radius="2xl" bg={on ? "info-soft" : "surface"} border="thick" borderTone={on ? "info" : "default"} edge={on ? "info-line" : "border"} edgeSize="sm" control="md" hit={false}>
            <Box grow gap="2xs">
              <Text variant="bodyStrong" tone={on ? "on-info-soft" : "default"}>{o.label}</Text>
              {o.description ? <Text variant="caption" tone={on ? "on-info-soft" : "muted"}>{o.description}</Text> : null}
            </Box>
            {on ? <Icon name="check" size="md" tone="on-info-soft" /> : null}
          </Touchable>
        );
      })}
    </Box>
  );
}
