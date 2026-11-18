import type { ComponentType, ReactNode } from "react";
import Svg, { ClipPath, Circle, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { type SvgIcon, type SvgNode, medusaIcons, type MedusaIconName } from "../constants/medusaIcons";
import { type IconSize, size } from "../constants/sizes";
import { type TextTone, useTextColor } from "./Text";

export type { MedusaIconName };

/** The literal type of 465 icons is huge; the component only needs the shape. */
const icons: Readonly<Record<MedusaIconName, SvgIcon>> = medusaIcons;

type SvgProps = Record<string, unknown>;

/** The elements the converter keeps (crates/uiconv, icons.rs: TAGS). */
const ELEMENTS: Record<string, ComponentType<SvgProps>> = {
  g: G as never,
  path: Path as never,
  circle: Circle as never,
  rect: Rect as never,
  defs: Defs as never,
  clipPath: ClipPath as never,
  linearGradient: LinearGradient as never,
  stop: Stop as never,
};

function draw(node: SvgNode, color: string, key: number): ReactNode {
  const Element = ELEMENTS[node.t];
  if (!Element) return null;
  const props: SvgProps = {};
  for (const [name, value] of Object.entries(node.a ?? {})) props[name] = value === "$color" || value === "currentColor" ? color : value;
  return <Element key={key} {...props}>{node.c?.map((child, i) => draw(child, color, i))}</Element>;
}

/**
 * A Medusa icon (MIT) at a token size, in a text tone. Fixed-colour icons (flags, brands) keep
 * their own colours. Decorative unless it has a label.
 */
export function MedusaIcon({ name, size: s = "md", tone = "default", label }: { name: MedusaIconName; size?: IconSize; tone?: TextTone; label?: string }) {
  const color = useTextColor()(tone);
  const icon = icons[name];
  return (
    <Svg
      width={size.icon[s]}
      height={size.icon[s]}
      viewBox={icon.vb}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      accessibilityLabel={label}
    >
      {icon.n.map((node, i) => draw(node, color, i))}
    </Svg>
  );
}
