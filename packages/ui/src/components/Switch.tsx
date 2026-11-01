import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable } from "react-native";

import { duration, state } from "../constants/misc";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

/** HeroUI's switch: a 48 x 24 track with an oval 28 x 20 knob, the same on every platform (not the system switch). */
export function Switch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const { colors, shadows } = useTheme();
  const at = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(at, { toValue: value ? 1 : 0, duration: duration.base, useNativeDriver: Platform.OS !== "web" }).start();
  }, [at, value]);
  const s = size.switch;
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      hitSlop={space.sm}
      style={{
        width: s.width,
        height: s.height,
        borderRadius: s.height,
        justifyContent: "center",
        backgroundColor: value ? colors.tones.accent.solid : colors.border.strong,
        opacity: disabled ? state.disabled : 1,
      }}
    >
      <Animated.View
        style={{
          width: s.thumbWidth,
          height: s.thumbHeight,
          borderRadius: s.thumbHeight,
          backgroundColor: colors.thumb,
          boxShadow: shadows.field === "none" ? undefined : shadows.field,
          marginLeft: s.inset,
          transform: [{ translateX: at.interpolate({ inputRange: [0, 1], outputRange: [0, s.travel] }) }],
        }}
      />
    </Pressable>
  );
}

/** A setting: a title, a line of explanation and the switch. */
export function SwitchRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row gap="md" touch align="center">
      <Box grow gap="2xs">
        <Text variant="body">{label}</Text>
        {description ? <Text variant="caption" tone="muted">{description}</Text> : null}
      </Box>
      <Switch value={value} onChange={onChange} label={label} />
    </Row>
  );
}
