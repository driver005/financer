import type { ReactNode } from "react";

import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import type { BoxProps } from "../primitives/box";
import { Touchable } from "../primitives/Touchable";

export type CardProps = {
  children: ReactNode;
  /** `raised` floats with a shadow, `outline` has only a border, `flat` is a quiet fill. */
  variant?: "raised" | "outline" | "flat";
  /** Tint the card with a tone's soft colour. */
  tone?: Tone;
  selected?: boolean;
  onPress?: () => void;
  label?: string;
  padded?: boolean;
  gap?: BoxProps["gap"];
  testID?: string;
};

export function Card({ children, variant = "outline", tone, selected, onPress, label, padded = true, gap = "md", testID }: CardProps) {
  const look: BoxProps = {
    bg: tone ? `${tone}-soft` : variant === "flat" ? "sunken" : "surface",
    radius: "xl",
    border: selected ? "thick" : variant === "raised" ? undefined : "hairline",
    borderTone: selected ? "accent" : "default",
    shadow: variant === "raised" ? "md" : undefined,
    p: padded ? "lg" : "none",
    gap,
    overflow: "hidden",
    grow: true,
  };
  if (!onPress) return <Box {...look} testID={testID}>{children}</Box>;
  return (
    <Touchable {...look} onPress={onPress} label={label} selected={selected} hit={false} testID={testID}>
      {children}
    </Touchable>
  );
}
