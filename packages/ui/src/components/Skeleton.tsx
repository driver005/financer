import { useEffect, useRef } from "react";
import { Animated, Platform } from "react-native";

import { duration } from "../constants/misc";
import { opacity } from "../constants/misc";
import { radius as radii, type Radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { useTheme } from "../theme/ThemeProvider";

/** A grey placeholder that breathes while content loads. */
export function Skeleton({ height = "md", radius = "md", width }: { height?: keyof typeof size.control; radius?: Radius; width?: "full" | "half" }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(opacity[100])).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: opacity[50], duration: duration.slower, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: opacity[100], duration: duration.slower, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: size.control[height], width: width === "half" ? "50%" : "100%", borderRadius: radii[radius], backgroundColor: colors.sunken, opacity: pulse }}
    />
  );
}
