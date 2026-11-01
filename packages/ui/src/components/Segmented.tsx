import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type SegmentedOption<T extends string> = { value: T; label: string };

/** A few exclusive choices side by side (view as grid or list, week or month). */
export function Segmented<T extends string>({ options, value, onChange, testID }: { options: readonly SegmentedOption<T>[]; value: T; onChange: (v: T) => void; testID?: string }) {
  return (
    <Row gap="2xs" bg="sunken" radius="2xl" p="xs" testID={testID} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Box key={o.value} equal>
            <Touchable
              onPress={() => onChange(o.value)}
              label={o.label}
              role="tab"
              selected={on}
              bg={on ? "surface" : undefined}
              border={on ? "thick" : undefined}
              borderTone="default"
              edge={on ? "border" : undefined}
              edgeSize="sm"
              radius="xl"
              control="sm"
              align="center"
              justify="center"
              px="sm"
              hit={false}
            >
              <Text variant="label" tone={on ? "info" : "muted"}>{o.label}</Text>
            </Touchable>
          </Box>
        );
      })}
    </Row>
  );
}
