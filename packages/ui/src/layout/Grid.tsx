import { Children, useState, type ReactNode } from "react";
import { View } from "react-native";

import { space, type Space } from "../constants/spacing";
import { Box } from "../primitives/Box";
import { type Responsive, resolve } from "../responsive/resolve";
import { useLayout } from "../responsive/useLayout";

/**
 * Children in equal columns. Without `columns` the count follows the window (2 on a phone, up to 5
 * on a wide screen). Items are as wide as the container allows, so cards line up on any width.
 */
export function Grid({ children, columns, gap = "md" }: { children: ReactNode; columns?: Responsive<number>; gap?: Space }) {
  const layout = useLayout();
  const [width, setWidth] = useState(0);
  const cols = Math.max(1, resolve(columns, layout.width) ?? layout.columns);
  const g = space[gap];
  const item = width > 0 ? (width - g * (cols - 1)) / cols : undefined;
  return (
    <Box direction="row" wrap gap={gap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {Children.toArray(children).map((child, i) => (
        <GridCell key={i} width={item} fallback={cols}>
          {child}
        </GridCell>
      ))}
    </Box>
  );
}

function GridCell({ width, fallback, children }: { width?: number; fallback: number; children: ReactNode }) {
  return <View style={{ width: width ?? `${100 / fallback}%`, flexDirection: "column" }}>{children}</View>;
}
