import { createContext, useContext, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

import { type Device, devices } from "../constants/breakpoints";
import { borderWidth, radius } from "../constants/radius";
import { Box } from "../primitives/Box";
import { useTheme } from "../theme/ThemeProvider";

const Ctx = createContext<number | null>(null);

/** The width responsive values are resolved against: a preview frame's, or else the window's. */
export function useViewportWidth(): number {
  const override = useContext(Ctx);
  const window = useWindowDimensions().width;
  return override ?? window;
}

/**
 * Show children as if the window were this device wide (the catalog uses it to look at a phone, a
 * tablet and a laptop side by side). Everything inside resolves its breakpoints against the frame.
 */
export function Viewport({ device, children }: { device: Device | "window"; children: ReactNode }) {
  if (device === "window") return <>{children}</>;
  const width = devices[device];
  return (
    <Ctx.Provider value={width}>
      <FrameWidth width={width}>{children}</FrameWidth>
    </Ctx.Provider>
  );
}

function FrameWidth({ width, children }: { width: number; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Box>
      <View
        style={{
          width,
          maxWidth: "100%",
          alignSelf: "center",
          backgroundColor: colors.background,
          borderWidth: borderWidth.hairline,
          borderColor: colors.border.strong,
          borderRadius: radius["2xl"],
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </Box>
  );
}
