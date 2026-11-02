// Breakpoints: Tailwind CSS 3.4.17 `screens` (minimum widths), and the three layout classes built on
// them. Layouts adapt by class, never by pixel checks in a screen.
//
//   compact   below md (768)      phones, also landscape phones: bottom navigation, 1 to 2 columns
//   medium    md up to lg (1024)  tablets: navigation rail, 2 to 3 columns
//   expanded  lg and up           large tablets, laptops, the web: sidebar, 3 to 5 columns
//
// This is Material 3's window-size-class idea with Tailwind's thresholds, so that a landscape phone
// (up to about 930 wide) does not get a tablet layout.

export const breakpoints = { base: 0, sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 } as const;

export type Breakpoint = keyof typeof breakpoints;

/** From small to large: the order values cascade in. */
export const breakpointOrder: readonly Breakpoint[] = ["base", "sm", "md", "lg", "xl", "2xl"];

export type LayoutClass = "compact" | "medium" | "expanded";

export function breakpointFor(width: number): Breakpoint {
  let found: Breakpoint = "base";
  for (const b of breakpointOrder) if (width >= breakpoints[b]) found = b;
  return found;
}

export function layoutClassFor(width: number): LayoutClass {
  if (width >= breakpoints.lg) return "expanded";
  if (width >= breakpoints.md) return "medium";
  return "compact";
}

/** Product grid columns per layout class and breakpoint (research: 2 on phones, more on larger). */
export const gridColumns = { base: 2, sm: 2, md: 3, lg: 3, xl: 4, "2xl": 5 } as const;

/** Window widths of the three device classes the catalog previews (a phone, a tablet in portrait, a laptop). */
export const devices = { phone: 390, tablet: 820, desktop: 1280 } as const;
export type Device = keyof typeof devices;
