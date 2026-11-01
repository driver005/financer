import type { ReactNode } from "react";
import { Pressable, type PressableProps, type ViewStyle } from "react-native";

import { state } from "../constants/misc";
import { size } from "../constants/sizes";
import { useViewportWidth } from "../responsive/Viewport";
import { useTheme } from "../theme/ThemeProvider";
import { type BoxProps, boxStyle } from "./box";

type Props = BoxProps & {
  children: ReactNode | ((s: { pressed: boolean; hovered: boolean }) => ReactNode);
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  role?: PressableProps["accessibilityRole"];
  selected?: boolean;
  testID?: string;
  /** Make the hit area at least a touch target even when the content is smaller. */
  hit?: boolean;
};

/** Anything tappable: pressed and disabled looks, the minimum hit area, a label for screen readers. */
export function Touchable({ children, onPress, onLongPress, disabled, busy, label, role = "button", selected, testID, hit = true, ...tokens }: Props) {
  const theme = useTheme();
  const width = useViewportWidth();
  const base: ViewStyle = boxStyle(tokens, theme, width);
  const slop = hit ? Math.round(size.touch / 4) : 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || busy}
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy), selected }}
      hitSlop={slop}
      style={({ pressed }) => [base, pressed && !disabled && { opacity: state.pressed }, disabled && { opacity: state.disabled }]}
    >
      {typeof children === "function" ? (s) => children({ pressed: s.pressed, hovered: Boolean((s as { hovered?: boolean }).hovered) }) : children}
    </Pressable>
  );
}
