import { useEffect } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/components/motion";
import { radius as r, space, usePalette } from "@/theme";

/** A grey block that pulses gently while content loads. Static with reduced motion. */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = r.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const reduce = useReduceMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      o.value = 1;
      return;
    }
    o.value = withRepeat(
      withSequence(withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [reduce, o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: p.accentSoft }, pulse, style]} />;
}

/**
 * Placeholder for a loading list: `rows` rows with a round icon, two lines of text and an amount,
 * inside a card like the real list. Announced once as "Loading" instead of every block.
 */
export function SkeletonList({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  const p = usePalette();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ borderWidth: 1, borderColor: p.border, borderRadius: 20, backgroundColor: p.surface, overflow: "hidden" }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            padding: space.lg,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: p.border,
          }}
        >
          <Skeleton width={40} height={40} radius={20} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width={`${55 + ((i * 13) % 30)}%`} height={14} />
            <Skeleton width="35%" height={10} />
          </View>
          <Skeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

/** Placeholder for a hero card: a ring-sized disc and two lines. */
export function SkeletonHero({ label = "Loading" }: { label?: string }) {
  const p = usePalette();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ borderWidth: 1, borderColor: p.border, borderRadius: 20, backgroundColor: p.surface, padding: space.xl, alignItems: "center", gap: space.md }}
    >
      <Skeleton width={180} height={180} radius={90} />
      <Skeleton width="50%" height={14} />
      <Skeleton width="70%" height={12} />
    </View>
  );
}
