import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { useReduceMotion } from "@/components/motion";
import { clamp01, dashOffset, ringGeometry } from "@/ring";
import { motion, usePalette } from "@/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A progress ring (plain react-native-svg, animated with Reanimated). `progress` is 0..1 and the
 * arc starts at 12 o'clock and runs clockwise. The children sit in the middle, so the hero number
 * can live inside it. The ring itself is decorative: give it an `accessibilityLabel` that says
 * the same thing in words and keep the real figures as text next to or inside it.
 */
export function Ring({
  progress,
  size = 200,
  stroke = 16,
  color,
  track,
  accessibilityLabel,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const p = usePalette();
  const reduce = useReduceMotion();
  const { c, r, circumference } = ringGeometry(size, stroke);
  const target = clamp01(progress);
  const drawn = useSharedValue(reduce ? target : 0);

  useEffect(() => {
    drawn.value = reduce ? target : withTiming(target, { duration: motion.progress, easing: Easing.out(Easing.cubic) });
  }, [target, reduce, drawn]);

  const arc = useAnimatedProps(() => ({ strokeDashoffset: dashOffset(circumference, drawn.value) }));

  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityLabel ? { min: 0, max: 100, now: Math.round(target * 100) } : undefined}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }} pointerEvents="none">
        <Circle cx={c} cy={c} r={r} stroke={track ?? p.accentSoft} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={c}
          cy={c}
          r={r}
          stroke={color ?? p.fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arc}
          // start at 12 o'clock
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      {children}
    </View>
  );
}
