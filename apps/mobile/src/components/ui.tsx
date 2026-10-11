import { Link } from "expo-router";
import { Card as HCard } from "heroui-native";
import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActivityIndicator, ChunkyButton, Text } from "@/components/kit";
import { usePalette } from "@/theme";

/** Colours used by the screens, taken from the active (light or dark) palette. */
export function useColors() {
  const p = usePalette();
  return {
    bg: p.background,
    card: p.surface,
    text: p.text,
    muted: p.muted,
    border: p.border,
    accent: p.accent,
    bad: p.bad,
    good: p.good,
  };
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <View className="flex-1 px-4">{children}</View>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <HCard className="mb-3 rounded-3xl border-2 border-border bg-surface shadow-none" style={style}>
      <HCard.Body>{children}</HCard.Body>
    </HCard>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text variant="headlineMedium" style={{ marginVertical: 12, fontWeight: "800" }} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, bold }: { children: ReactNode; muted?: boolean; bold?: boolean }) {
  return (
    <Text
      variant="bodyLarge"
      className={muted ? "text-muted" : undefined}
      style={{ fontWeight: bold ? "600" : "400", ...(muted ? { opacity: 1 } : null) }}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  icon,
  mode = "contained",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: string;
  mode?: "contained" | "outlined" | "text" | "contained-tonal";
}) {
  return (
    <ChunkyButton
      label={label}
      onPress={onPress}
      disabled={disabled}
      icon={icon}
      outline={mode === "outlined"}
      flat={mode === "text"}
      tone={mode === "contained-tonal" ? "blue" : "green"}
    />
  );
}

/** Progress bar that slides to its value. `progress` is 0..1; `color` overrides the green. */
export function Bar({
  progress,
  color,
  marginTop = 6,
  height = 10,
}: {
  progress: number;
  color?: string;
  marginTop?: number;
  height?: number;
}) {
  const p = usePalette();
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(pct, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [pct, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View
      style={{ height, marginTop, borderRadius: height, overflow: "hidden", backgroundColor: p.border }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      <Animated.View style={[{ height: "100%", borderRadius: height, backgroundColor: color ?? p.fill }, fill]} />
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading" />;
}

/** Shown on every tab until the server URL and token are saved. */
export function NeedsSetup() {
  const c = useColors();
  return (
    <Card>
      <Body bold>Connect to your server first</Body>
      <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 4 }}>
        Enter the server address and API token in Settings.
      </Text>
      <Link href="/settings" style={{ color: c.accent, marginTop: 12, fontSize: 16 }}>
        Open Settings
      </Link>
    </Card>
  );
}
