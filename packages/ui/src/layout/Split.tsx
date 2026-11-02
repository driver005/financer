import { Children, type ReactNode } from "react";

import type { Space } from "../constants/spacing";
import { Box, Row, Stack } from "../primitives/Box";
import { useLayout } from "../responsive/useLayout";

/**
 * Two (or more) blocks side by side on a tablet and a laptop, one under the other on a phone. Each gets
 * an equal share; use it for a picture beside the price, or a form beside its result.
 * `from` is the smallest layout that puts them side by side.
 */
export function Split({ children, gap = "xl", from = "medium" }: { children: ReactNode; gap?: Space; from?: "medium" | "expanded" }) {
  const { isCompact, isMedium } = useLayout();
  const side = from === "medium" ? !isCompact : !isCompact && !isMedium;
  const items = Children.toArray(children);
  if (!side) return <Stack gap={gap}>{items}</Stack>;
  return (
    <Row gap={gap} align="start">
      {items.map((c, i) => (
        <Box key={i} equal gap="xl">
          {c}
        </Box>
      ))}
    </Row>
  );
}
