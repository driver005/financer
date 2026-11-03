import type { ReactNode } from "react";
import { View } from "react-native";

import { zIndex } from "../constants/misc";
import { space } from "../constants/spacing";
import { useTheme } from "../theme/ThemeProvider";

/** Covers the whole app (a lock screen), above everything else, with its content in the middle. */
export function Cover({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background, zIndex: zIndex.modal, elevation: zIndex.modal, alignItems: "center", justifyContent: "center", padding: space.xl }}
    >
      {children}
    </View>
  );
}

/** Props for a root view that fills the window (`<GestureHandlerRootView {...fill}>`). */
export const fill = { style: { flex: 1 } } as const;
