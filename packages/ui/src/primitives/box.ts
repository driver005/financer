// Turns token props into a React Native style. The only place props become numbers and colours.
import type { DimensionValue, ViewStyle } from "react-native";

import type { Tone } from "../constants/colors";
import { type BorderWidth, type Radius, borderWidth, radius } from "../constants/radius";
import { type Shadow, shadows } from "../constants/shadows";
import { type ControlSize, size } from "../constants/sizes";
import { type Space, space } from "../constants/spacing";
import { type Responsive, resolve } from "../responsive/resolve";
import type { Theme } from "../theme/ThemeProvider";

export type BgToken = "background" | "surface" | "raised" | "sunken" | "scrim" | `${Tone}-soft` | `${Tone}-solid`;
export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type Justify = "start" | "center" | "end" | "between" | "around";
export type Dim = `icon-${keyof typeof size.icon}` | `avatar-${keyof typeof size.avatar}` | `thumb-${keyof typeof size.thumb}` | `ring-${keyof typeof size.ring}`;

export function dimValue(d: Dim): number {
  const [group, key] = d.split("-") as ["icon" | "avatar" | "thumb" | "ring", string];
  return (size[group] as Record<string, number>)[key];
}

export type MaxWidth = keyof typeof size.content;
export type Basis = "auto" | "full" | "half";

/** React Native 0.88 types styles as read-only; a style under construction is not. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const r = <T,>(v: Responsive<T> | undefined) => v;

export type BoxProps = {
  p?: Responsive<Space>;
  px?: Responsive<Space>;
  py?: Responsive<Space>;
  pt?: Responsive<Space>;
  pr?: Responsive<Space>;
  pb?: Responsive<Space>;
  pl?: Responsive<Space>;
  m?: Responsive<Space>;
  mx?: Responsive<Space>;
  my?: Responsive<Space>;
  mt?: Responsive<Space>;
  mr?: Responsive<Space>;
  mb?: Responsive<Space>;
  ml?: Responsive<Space>;
  gap?: Responsive<Space>;
  direction?: Responsive<"row" | "column">;
  align?: Responsive<Align>;
  justify?: Responsive<Justify>;
  wrap?: boolean;
  /** Take the remaining space along the parent's direction (and shrink when short of it). */
  grow?: boolean;
  /** Equal shares of the parent with the other `equal` children (columns of a table, segments, tabs). */
  equal?: boolean;
  shrink?: boolean;
  /** Width as a share of the parent. */
  basis?: Responsive<Basis>;
  /** Limit the width to a content column and centre it. */
  maxW?: MaxWidth;
  bg?: BgToken;
  radius?: Radius;
  border?: BorderWidth;
  borderTone?: Tone | "default" | "strong";
  shadow?: Shadow;
  overflow?: "hidden" | "visible";
  /** A fixed height for previews that need a bounded box. */
  h?: "preview";
  /** Never taller than a sheet may be (85 % of the window). */
  maxH?: "sheet";
  /** Keep it mounted (its state survives) but not shown. */
  hidden?: boolean;
  /** Stretch to the full width of the parent. */
  full?: boolean;
  /** Keep the box square (aspect ratio 1). */
  square?: boolean;
  /** Minimum height of a touch target. */
  touch?: boolean;
  /** A fixed square of a token size: `icon-md`, `avatar-lg`, `thumb-sm`, `ring-md`. */
  dim?: Dim;
  /** Height of a control (button, input, chip row): sm 36, md 44, lg 48. */
  control?: ControlSize;
};

const ALIGN: Record<Align, ViewStyle["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY: Record<Justify, ViewStyle["justifyContent"]> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around",
};
const SHEET_MAX_HEIGHT = "85%";
const BASIS: Record<Basis, DimensionValue> = { auto: "auto", full: "100%", half: "50%" };

export function bgColor(bg: BgToken, theme: Theme): string {
  const c = theme.colors;
  if (bg === "background" || bg === "surface" || bg === "raised" || bg === "sunken") return c[bg];
  if (bg === "scrim") return c.scrim;
  const [tone, kind] = bg.split("-") as [Tone, "soft" | "solid"];
  return c.tones[tone][kind];
}

export function boxStyle(p: BoxProps, theme: Theme, width: number): ViewStyle {
  const sp = (v: Responsive<Space> | undefined): number | undefined => {
    const s = resolve(r(v), width);
    return s === undefined ? undefined : space[s];
  };
  const style: Mutable<ViewStyle> = {};
  const set = <K extends keyof ViewStyle>(key: K, value: ViewStyle[K] | undefined) => {
    if (value !== undefined) style[key] = value;
  };
  set("padding", sp(p.p));
  set("paddingHorizontal", sp(p.px));
  set("paddingVertical", sp(p.py));
  set("paddingTop", sp(p.pt));
  set("paddingRight", sp(p.pr));
  set("paddingBottom", sp(p.pb));
  set("paddingLeft", sp(p.pl));
  set("margin", sp(p.m));
  set("marginHorizontal", sp(p.mx));
  set("marginVertical", sp(p.my));
  set("marginTop", sp(p.mt));
  set("marginRight", sp(p.mr));
  set("marginBottom", sp(p.mb));
  set("marginLeft", sp(p.ml));
  set("gap", sp(p.gap));
  set("flexDirection", resolve(p.direction, width));
  const align = resolve(p.align, width);
  if (align) style.alignItems = ALIGN[align];
  const justify = resolve(p.justify, width);
  if (justify) style.justifyContent = JUSTIFY[justify];
  if (p.wrap) style.flexWrap = "wrap";
  if (p.grow || p.equal) {
    style.flexGrow = 1;
    style.flexShrink = 1;
  }
  if (p.equal) style.flexBasis = 0;
  if (p.shrink === false) style.flexShrink = 0;
  const basis = resolve(p.basis, width);
  if (basis) style.width = BASIS[basis];
  if (p.maxW) {
    style.maxWidth = size.content[p.maxW];
    style.width = "100%";
    style.alignSelf = "center";
  }
  if (p.maxH) style.maxHeight = SHEET_MAX_HEIGHT;
  if (p.h) style.height = size.preview;
  if (p.hidden) style.display = "none";
  if (p.full) style.width = "100%";
  if (p.square) style.aspectRatio = 1;
  if (p.dim) {
    style.width = dimValue(p.dim);
    style.height = dimValue(p.dim);
  }
  if (p.touch) style.minHeight = size.touch;
  if (p.control) style.minHeight = size.control[p.control];
  if (p.bg) style.backgroundColor = bgColor(p.bg, theme);
  if (p.radius) style.borderRadius = radius[p.radius];
  if (p.border) {
    style.borderWidth = borderWidth[p.border];
    const t = p.borderTone ?? "default";
    style.borderColor = t === "default" ? theme.colors.border.default : t === "strong" ? theme.colors.border.strong : theme.colors.tones[t].line;
  }
  if (p.shadow && p.shadow !== "none") style.boxShadow = shadows[p.shadow];
  if (p.overflow) style.overflow = p.overflow;
  return style;
}
