import type { ReactNode } from "react";

import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import type { BoxProps } from "../primitives/box";
import { Touchable } from "../primitives/Touchable";

export type CardProps = {
  children: ReactNode;
  /** `raised` has a 2 px line and a thick edge below, like a key, `outline` has only a border, `flat` is a quiet fill. */
  variant?: "raised" | "outline" | "flat";
  /** Tint the card with a tone's soft colour. */
  tone?: Tone;
  selected?: boolean;
  onPress?: () => void;
  label?: string;
  padded?: boolean;
  /** Fill the height of the cell it is in (cards side by side keep one height). */
  fill?: boolean;
  gap?: BoxProps["gap"];
  testID?: string;
};

export function Card({ children, variant = "raised", tone, selected, onPress, label, padded = true, fill, gap = "md", testID }: CardProps) {
  const look: BoxProps = {
    bg: selected ? "info-soft" : tone ? `${tone}-soft` : variant === "flat" ? "sunken" : "surface",
    radius: "2xl",
    border: variant === "flat" && !selected && !tone ? undefined : "thick",
    borderTone: selected ? "info" : tone ?? "default",
    // a raised card sits on a thick edge, like a key; a selected one on a blue edge
    edge: selected ? "info-line" : variant === "raised" ? (tone ? `${tone}-line` : "border") : undefined,
    p: padded ? "lg" : "none",
    gap,
    overflow: "hidden",
    grow: fill,
  };
  if (!onPress) return <Box {...look} testID={testID}>{children}</Box>;
  return (
    <Touchable {...look} onPress={onPress} label={label} selected={selected} hit={false} testID={testID}>
      {children}
    </Touchable>
  );
}
