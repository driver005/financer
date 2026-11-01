import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { useViewportWidth } from "../responsive/Viewport";
import { useTheme } from "../theme/ThemeProvider";
import { type BoxProps, boxStyle } from "./box";

export type { BoxProps } from "./box";

type Accessibility = Pick<ViewProps, "accessibilityRole" | "accessibilityLabel" | "accessibilityState" | "accessibilityValue" | "accessible" | "testID" | "pointerEvents" | "onLayout">;

/** A view whose layout comes from tokens only. */
export function Box({ children, ...rest }: BoxProps & Accessibility & { children?: ReactNode }) {
  const theme = useTheme();
  const width = useViewportWidth();
  const { accessibilityRole, accessibilityLabel, accessibilityState, accessibilityValue, accessible, testID, pointerEvents, onLayout, ...tokens } = rest;
  return (
    <View
      style={boxStyle(tokens, theme, width)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      accessibilityValue={accessibilityValue}
      accessible={accessible}
      testID={testID}
      pointerEvents={pointerEvents}
      onLayout={onLayout}
    >
      {children}
    </View>
  );
}

/** Children one under the other. */
export function Stack({ gap = "md", ...rest }: Parameters<typeof Box>[0]) {
  return <Box direction="column" gap={gap} {...rest} />;
}

/** Children side by side, vertically centred. */
export function Row({ gap = "sm", align = "center", ...rest }: Parameters<typeof Box>[0]) {
  return <Box direction="row" gap={gap} align={align} {...rest} />;
}

/** Empty space that grows, or a fixed gap. */
export function Spacer({ size }: { size?: BoxProps["p"] }) {
  return size ? <Box p={size} /> : <Box grow />;
}
