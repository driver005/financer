import { useEffect, useRef } from "react";
import { Animated, Easing, View, useWindowDimensions } from "react-native";

import type { Tone } from "../constants/colors";
import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { useTheme } from "../theme/ThemeProvider";

const COUNT = 28;
const TONES: Tone[] = ["accent", "success", "warning", "info", "danger"];

function Piece({ index, height }: { index: number; height: number }) {
  const { colors } = useTheme();
  const y = useRef(new Animated.Value(-height / 8)).current;
  useEffect(() => {
    const t = Animated.timing(y, { toValue: height + space["3xl"], duration: 2400 + (index % 5) * 350, delay: (index * 70) % 1200, easing: Easing.in(Easing.quad), useNativeDriver: true });
    t.start();
    return () => t.stop();
  }, [index, height, y]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: `${(index * 37) % 96}%`,
        width: size.stroke.xl + (index % 3) * size.stroke.md,
        height: size.stroke.xl * 3 + (index % 4) * size.stroke.md,
        borderRadius: radius.sm,
        backgroundColor: colors.tones[TONES[index % TONES.length]].solid,
        transform: [{ translateY: y }, { rotate: `${(index * 47) % 360}deg` }],
      }}
    />
  );
}

/** Confetti-like pieces falling once, over the whole screen. */
export function Confetti() {
  const { height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: COUNT }, (_, i) => (
        <Piece key={i} index={i} height={height} />
      ))}
    </View>
  );
}
