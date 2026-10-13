import { type ReactNode } from "react";
import { Text as RNText, View } from "react-native";

import { radius, space } from "@/components/grocery/primitives";
import { usePalette } from "@/theme";

const ARM = 28;
const THICK = 5;

function Corner({ at, colour }: { at: "tl" | "tr" | "bl" | "br"; colour: string }) {
  const top = at[0] === "t";
  const left = at[1] === "l";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        [top ? "top" : "bottom"]: space.lg,
        [left ? "left" : "right"]: space.lg,
        width: ARM,
        height: ARM,
        borderColor: colour,
        borderTopWidth: top ? THICK : 0,
        borderBottomWidth: top ? 0 : THICK,
        borderLeftWidth: left ? THICK : 0,
        borderRightWidth: left ? 0 : THICK,
        borderTopLeftRadius: top && left ? 12 : 0,
        borderTopRightRadius: top && !left ? 12 : 0,
        borderBottomLeftRadius: !top && left ? 12 : 0,
        borderBottomRightRadius: !top && !left ? 12 : 0,
      }}
    />
  );
}

/**
 * The scan area: four corner brackets and a line of guidance. With a camera, `children` is the
 * live view behind the brackets; without, it is an illustration on a quiet background.
 */
export function ScanFrame({ children, hint, live, height = 240 }: { children?: ReactNode; hint: string; live?: boolean; height?: number }) {
  const p = usePalette();
  // on the camera the brackets and the hint are white on a dark chip, so they read on any picture
  const bracket = live ? "#ffffff" : p.accent;
  return (
    <View
      style={{
        height,
        borderRadius: radius.lg,
        overflow: "hidden",
        backgroundColor: live ? "#000000" : p.surfaceAlt,
        borderWidth: 2,
        borderColor: p.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
      <Corner at="tl" colour={bracket} />
      <Corner at="tr" colour={bracket} />
      <Corner at="bl" colour={bracket} />
      <Corner at="br" colour={bracket} />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: space.xl + space.sm,
          alignSelf: "center",
          maxWidth: "80%",
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
          borderRadius: 999,
          backgroundColor: live ? "rgba(0,0,0,0.65)" : "transparent",
        }}
      >
        <RNText style={{ color: live ? "#ffffff" : p.muted, fontSize: 14, fontWeight: "700", textAlign: "center" }}>{hint}</RNText>
      </View>
    </View>
  );
}
