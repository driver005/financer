import { Box } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type Option<T extends string> = { value: T; label: string; description?: string };

/** A list where exactly one option is chosen (sorting, language). */
export function OptionList<T extends string>({ options, value, onChange }: { options: readonly Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <Box gap="xs" accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable key={o.value} onPress={() => onChange(o.value)} label={o.label} role="radio" selected={on} direction="row" align="center" gap="md" px="md" py="sm" radius="lg" bg={on ? "accent-soft" : undefined} control="md" hit={false}>
            <Box grow gap="2xs">
              <Text variant="body" tone={on ? "on-accent-soft" : "default"}>{o.label}</Text>
              {o.description ? <Text variant="caption" tone={on ? "on-accent-soft" : "muted"}>{o.description}</Text> : null}
            </Box>
            {on ? <Icon name="check" size="md" tone="on-accent-soft" /> : null}
          </Touchable>
        );
      })}
    </Box>
  );
}
