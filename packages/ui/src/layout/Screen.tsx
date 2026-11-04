import { useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MaxWidth } from "../primitives/boxStyle";
import { Box } from "../primitives/Box";
import { useTheme } from "../theme/ThemeProvider";

export type ScreenProps = {
  children: ReactNode;
  /** Pinned under the content (a primary action on a phone, the box a chat message is typed in). It rises above the keyboard. */
  footer?: ReactNode;
  /** Pinned above the content (the top bar). */
  header?: ReactNode;
  /** Content column width on large screens. */
  maxW?: MaxWidth;
  /** Do not scroll (the content manages its own scrolling). */
  fixed?: boolean;
  /** Open scrolled to the end and stay there as content is added (a chat). */
  startAtEnd?: boolean;
  /** Keep the footer clear of the home indicator (a page without a bottom bar). */
  safeBottom?: boolean;
};

/**
 * One page: safe areas, a scrolling content column that stays readable on a wide screen (it is
 * centred with a maximum width and grows its gutters), an optional header and footer.
 */
export function Screen({ children, footer, header, maxW = "wide", fixed, startAtEnd, safeBottom }: ScreenProps) {
  const { colors } = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  const column = (
    <Box maxW={maxW} px={{ base: "lg", md: "xl", lg: "2xl" }} py={{ base: "lg", md: "xl" }} gap="xl" grow={fixed}>
      {children}
    </Box>
  );
  return (
    <SafeAreaView edges={safeBottom ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header}
        {fixed ? (
          <View style={{ flex: 1 }}>{column}</View>
        ) : (
          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={startAtEnd ? () => scroller.current?.scrollToEnd({ animated: false }) : undefined}
          >
            {column}
          </ScrollView>
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
