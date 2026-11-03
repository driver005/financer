import type { ReactNode } from "react";
import { ScrollView } from "react-native";

import { Box } from "../primitives/Box";

/**
 * A scrolling area inside a page that does not scroll itself (a `Screen` with `fixed`): the part
 * below a toolbar that must stay in place. The bottom is left clear so a floating button never
 * covers the last row.
 */
export function Scroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Box pb="4xl" gap="md">{children}</Box>
    </ScrollView>
  );
}
