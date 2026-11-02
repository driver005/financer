import { useWindowDimensions } from "react-native";

import { useViewportWidth } from "./Viewport";
import { type Breakpoint, type LayoutClass, breakpointFor, gridColumns, layoutClassFor } from "../constants/breakpoints";
import { type Responsive, resolve } from "./resolve";

export type Layout = {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  /** compact (phone), medium (tablet), expanded (large tablet, laptop, web). */
  layout: LayoutClass;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  /** Product grid columns for this width. */
  columns: number;
};

/** The window size, as classes. Screens branch on these, never on pixels. */
export function useLayout(): Layout {
  const width = useViewportWidth();
  const { height } = useWindowDimensions();
  const breakpoint = breakpointFor(width);
  const layout = layoutClassFor(width);
  return {
    width,
    height,
    breakpoint,
    layout,
    isCompact: layout === "compact",
    isMedium: layout === "medium",
    isExpanded: layout === "expanded",
    columns: gridColumns[breakpoint],
  };
}

/** A responsive value resolved for the current window. */
export function useResponsive<T>(value: Responsive<T>): T | undefined {
  return resolve(value, useViewportWidth());
}
