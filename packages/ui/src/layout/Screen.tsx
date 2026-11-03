import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MaxWidth } from "../primitives/boxStyle";
import { Box } from "../primitives/Box";
import { useTheme } from "../theme/ThemeProvider";

export type ScreenProps = {
  children: ReactNode;
  /** Pinned under the content (a primary action on a phone). */
  footer?: ReactNode;
  /** Pinned above the content (the top bar). */
  header?: ReactNode;
  /** Content column width on large screens. */
  maxW?: MaxWidth;
  /** Do not scroll (the content manages its own scrolling). */
  fixed?: boolean;
  /** Keep the footer clear of the home indicator (a page without a bottom bar). */
  safeBottom?: boolean;
};

/**
 * One page: safe areas, a scrolling content column that stays readable on a wide screen (it is
 * centred with a maximum width and grows its gutters), an optional header and footer.
 */
export function Screen({ children, footer, header, maxW = "wide", fixed, safeBottom }: ScreenProps) {
  const { colors } = useTheme();
  const column = (
    <Box maxW={maxW} px={{ base: "lg", md: "xl", lg: "2xl" }} py={{ base: "lg", md: "xl" }} gap="xl" grow={fixed}>
      {children}
    </Box>
  );
  return (
    <SafeAreaView edges={safeBottom ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      {fixed ? <View style={{ flex: 1 }}>{column}</View> : <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">{column}</ScrollView>}
      {footer}
    </SafeAreaView>
  );
}
