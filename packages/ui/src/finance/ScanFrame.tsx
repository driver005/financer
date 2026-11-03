import type { ComponentType, ReactNode } from "react";
import { View } from "react-native";

import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

const ARM = space.xl + space.sm;

function Corner({ at, colour }: { at: "tl" | "tr" | "bl" | "br"; colour: string }) {
  const top = at[0] === "t";
  const left = at[1] === "l";
  const w = size.stroke.xl;
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
        borderTopWidth: top ? w : 0,
        borderBottomWidth: top ? 0 : w,
        borderLeftWidth: left ? w : 0,
        borderRightWidth: left ? 0 : w,
        borderTopLeftRadius: top && left ? radius.xl : 0,
        borderTopRightRadius: top && !left ? radius.xl : 0,
        borderBottomLeftRadius: !top && left ? radius.xl : 0,
        borderBottomRightRadius: !top && !left ? radius.xl : 0,
      }}
    />
  );
}

/**
 * The scan area: four corner brackets and a line of guidance. With a camera (`camera`, the camera
 * component of the platform, and its `cameraProps`) the live picture fills the frame behind the
 * brackets; without, `children` is an illustration on a quiet background.
 */
export function ScanFrame({ children, hint, live, camera: Camera, cameraProps, tall }: { children?: ReactNode; hint: string; live?: boolean; camera?: ComponentType<Record<string, unknown>>; cameraProps?: Record<string, unknown>; tall?: boolean }) {
  const { colors } = useTheme();
  // on the camera the brackets and the hint are white on a dark chip, so they read on any picture
  const bracket = live ? colors.media.ink : colors.tones.accent.text;
  return (
    <View
      style={{
        height: tall ? size.thumb.lg + size.thumb.md : size.thumb.lg + size.thumb.sm,
        borderRadius: radius["3xl"],
        overflow: "hidden",
        backgroundColor: live ? colors.media.backdrop : colors.sunken,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {Camera ? <Camera style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} {...cameraProps} /> : null}
      {children}
      <Corner at="tl" colour={bracket} />
      <Corner at="tr" colour={bracket} />
      <Corner at="bl" colour={bracket} />
      <Corner at="br" colour={bracket} />
      <View
        pointerEvents="none"
        style={{ position: "absolute", bottom: space.xl, alignSelf: "center", maxWidth: "80%", paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.full, backgroundColor: live ? colors.media.chip : "transparent" }}
      >
        <Text variant="label" align="center" tone={live ? "on-accent-solid" : "muted"}>{hint}</Text>
      </View>
    </View>
  );
}
