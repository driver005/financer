import { Box } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

/** A big button for one of a few ways to do the same thing (scan, photo, PDF): icon, name and a hint. */
export function TileButton({ icon, label, hint, onPress, disabled, primary }: { icon: IconName; label: string; hint?: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Box equal>
      <Touchable
        onPress={onPress}
        disabled={disabled}
        label={hint ? `${label}, ${hint}` : label}
        bg={primary ? "accent-solid" : "surface"}
        radius="2xl"
        shadow={primary ? undefined : "surface"}
        p="md"
        gap="2xs"
        align="center"
        justify="center"
        touch
      >
        <Icon name={icon} size="xl" tone={primary ? "on-accent-solid" : "accent"} />
        <Text variant="label" tone={primary ? "on-accent-solid" : "default"}>{label}</Text>
        {hint ? <Text variant="caption" tone={primary ? "on-accent-solid" : "muted"} numberOfLines={1}>{hint}</Text> : null}
      </Touchable>
    </Box>
  );
}
