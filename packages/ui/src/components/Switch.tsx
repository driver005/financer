import { Switch as RNSwitch } from "react-native";

import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={{ false: colors.border.strong, true: colors.tones.accent.solid }}
      thumbColor={colors.surface}
      // react-native-web paints the "on" thumb in its own green unless told otherwise
      {...({ activeThumbColor: colors.surface } as object)}
    />
  );
}

/** A setting: a title, a line of explanation and the switch. */
export function SwitchRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row gap="md" touch>
      <Box grow gap="2xs">
        <Text variant="body">{label}</Text>
        {description ? <Text variant="caption" tone="muted">{description}</Text> : null}
      </Box>
      <Switch value={value} onChange={onChange} label={label} />
    </Row>
  );
}
