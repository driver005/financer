import { useEffect } from "react";
import { Text as RNText, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { usePalette } from "@/theme";

/** Penny the piggy bank: bobs gently and talks in a speech bubble. */
export function Mascot({ message }: { message: string }) {
  const p = usePalette();
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(
      withSequence(withTiming(-6, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [y]);
  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          {
            width: 76,
            height: 76,
            borderRadius: 38,
            backgroundColor: p.fill,
            borderBottomWidth: 4,
            borderBottomColor: p.accentEdge,
            alignItems: "center",
            justifyContent: "center",
          },
          bob,
        ]}
      >
        <RNText style={{ fontSize: 40 }}>🐷</RNText>
      </Animated.View>
      <View
        accessibilityRole="text"
        style={{
          flex: 1,
          borderWidth: 2,
          borderColor: p.border,
          borderRadius: 18,
          backgroundColor: p.surface,
          paddingVertical: 10,
          paddingHorizontal: 14,
        }}
      >
        <RNText style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{message}</RNText>
      </View>
    </View>
  );
}
