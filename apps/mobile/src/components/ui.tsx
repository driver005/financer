import { useRouter } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Text as RNText, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ActivityIndicator, ChunkyButton, Text } from "@/components/kit";
import { useReduceMotion } from "@/components/motion";
import { SkeletonList } from "@/components/Skeleton";
import { elevation, motion, radius, space, typography, usePalette } from "@/theme";

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

/**
 * A full-height page in the theme's background colour, safe-area aware. Written with style props,
 * not utility classes: on a phone the classes were not applied (the page collapsed to nothing and
 * the scrolling content inside it was invisible), while style props always are.
 */
export function Page({ edges = ["top", "left", "right"], children }: { edges?: Edge[]; children: ReactNode }) {
  const p = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.background }} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <Page>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>{children}</View>
    </Page>
  );
}

/**
 * The standard surface: a rounded card with a hairline border and a barely visible shadow
 * (`elevation.card`). Pass `flush` to drop the padding, e.g. for a list that runs to the edges.
 */
export function Card({ children, style, flush }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          marginBottom: space.md,
          borderRadius: radius.xl,
          borderWidth: 2,
          borderColor: p.border,
          backgroundColor: p.surface,
          padding: flush ? 0 : space.lg,
        },
        elevation.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Screen title. `subtitle` is a quiet line under it; `right` sits at the end of the row. */
export function Title({ children, subtitle, right }: { children: ReactNode; subtitle?: string; right?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, marginTop: space.md, marginBottom: space.md }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="headlineMedium" style={{ fontWeight: "800" }} accessibilityRole="header">
          {children}
        </Text>
        {subtitle ? <RNText style={[typography.caption, { color: p.muted }]}>{subtitle}</RNText> : null}
      </View>
      {right}
    </View>
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

/**
 * Progress bar that slides to its value (it jumps there with reduced motion). `progress` is
 * 0..1; `color` overrides the purple. Give it an `accessibilityLabel` when the bar means
 * something that the surrounding text does not say.
 */
export function Bar({
  progress,
  color,
  marginTop = 6,
  height = 10,
  accessibilityLabel,
}: {
  progress: number;
  color?: string;
  marginTop?: number;
  height?: number;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  const reduce = useReduceMotion();
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100;
  const width = useSharedValue(reduce ? pct : 0);
  useEffect(() => {
    width.value = reduce ? pct : withTiming(pct, { duration: motion.progress, easing: Easing.out(Easing.cubic) });
  }, [pct, width, reduce]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View
      style={{ height, marginTop, borderRadius: height, overflow: "hidden", backgroundColor: p.accentSoft }}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      <Animated.View style={[{ height: "100%", borderRadius: height, backgroundColor: color ?? p.fill }, fill]} />
    </View>
  );
}

/**
 * Loading placeholder. The default is a spinner; `variant="skeleton"` shows grey rows shaped like
 * a list, which is what list screens use so the layout does not jump when data arrives.
 */
export function Loading({ variant = "spinner", rows }: { variant?: "spinner" | "skeleton"; rows?: number }) {
  if (variant === "skeleton") return <SkeletonList rows={rows} />;
  return <ActivityIndicator style={{ marginTop: 40 }} accessibilityLabel="Loading" />;
}

/** Shown on every tab until the server URL and token are saved. */
export function NeedsSetup() {
  const router = useRouter();
  return (
    <EmptyState
      title="Connect to your server first"
      message="Enter the server address and API token in Settings and your numbers show up here."
      actionLabel="Open Settings"
      actionIcon="cog-outline"
      onAction={() => router.push("/settings")}
    />
  );
}
