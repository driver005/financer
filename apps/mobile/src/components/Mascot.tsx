import { useEffect } from "react";
import { Text as RNText, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/components/motion";
import type { Mood } from "@/game";
import { radius, space, typography, usePalette } from "@/theme";

const BADGE: Record<Mood, string | null> = { happy: null, cheer: "🎉", worried: "💦" };

/**
 * Penny the piggy bank's face: a round purple badge with the pig. Today this is an emoji that
 * bobs and reacts to `mood`; the plan is to replace the emoji with a Rive mascot (docs/MASCOT.md),
 * which takes the same `mood` input. `size` scales the badge; the bob stops with reduced motion.
 */
export function MascotFace({ mood = "happy", size = 76 }: { mood?: Mood; size?: number }) {
  const p = usePalette();
  const reduce = useReduceMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      y.value = 0;
      return;
    }
    y.value = withRepeat(
      withSequence(withTiming(-size / 12, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [y, size, reduce]);
  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: p.fill,
          borderBottomWidth: Math.max(3, Math.round(size / 19)),
          borderBottomColor: p.accentEdge,
          alignItems: "center",
          justifyContent: "center",
        },
        bob,
      ]}
    >
      <RNText style={{ fontSize: Math.round(size * 0.53) }}>🐷</RNText>
      {BADGE[mood] ? <RNText style={{ position: "absolute", top: -6, right: -4, fontSize: Math.round(size * 0.32) }}>{BADGE[mood]}</RNText> : null}
    </Animated.View>
  );
}

/** Penny the piggy bank: bobs gently and talks in a speech bubble. */
export function Mascot({ message, mood = "happy" }: { message: string; mood?: Mood }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md }}>
      <MascotFace mood={mood} />
      <View
        accessibilityRole="text"
        style={{
          flex: 1,
          borderWidth: 2,
          borderColor: p.border,
          borderRadius: radius.xl,
          backgroundColor: p.surface,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
        }}
      >
        <RNText style={[typography.bodyStrong, { color: p.text }]}>{message}</RNText>
      </View>
    </View>
  );
}
