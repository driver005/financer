import { MaterialCommunityIcons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Pressable, Text as RNText, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { areaFor } from "@/navigation";
import { ActivityIndicator, ChunkyButton, Text } from "@/components/kit";
import { useReduceMotion } from "@/components/motion";
import { SkeletonList } from "@/components/Skeleton";
import { motion, space, typography, usePalette } from "@/theme";

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
  const dark = useColorScheme() === "dark";
  // the settings area has a faintly grey page (light theme), so it reads as a place of its own
  const grey = areaFor(usePathname()) === "settings" && !dark;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: grey ? p.surfaceAlt : p.background }} edges={edges}>
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
 * The standard section: a flat strip on the page background, closed by a hairline. No box, no
 * shadow, so figures and lists line up on the page margin. Pass `flush` to drop the bottom
 * padding, e.g. for a list that runs to the edge.
 */
export function Card({ children, style, flush }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          marginBottom: space.lg,
          paddingBottom: flush ? 0 : space.lg,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Screen title. `subtitle` is a quiet line under it; `right` sits at the end of the row. On the
 * everyday screens a Settings button ends the row; in the settings area a back button starts it.
 */
export function Title({ children, subtitle, right }: { children: ReactNode; subtitle?: string; right?: ReactNode }) {
  const p = usePalette();
  const router = useRouter();
  const area = areaFor(usePathname());
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.xs, marginBottom: space.md }}>
      {area === "settings" ? (
        <HeaderAction icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="headlineMedium" style={{ fontWeight: "800" }} accessibilityRole="header">
          {children}
        </Text>
        {subtitle ? <RNText style={[typography.caption, { color: p.muted }]}>{subtitle}</RNText> : null}
      </View>
      {right}
      {area === "tab" ? <HeaderAction icon="cog-outline" label="Settings" onPress={() => router.push("/settings")} /> : null}
    </View>
  );
}

/**
 * A round icon button for the title bar (`Title`'s `right`): the screen's tools live here instead
 * of as full-width buttons above the content. Always give it a `label`, it is the accessible name.
 */
export function HeaderAction({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? p.accentSoft : p.surfaceAlt,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]} size={22} color={p.accent} />
    </Pressable>
  );
}

/** One line of a summary card: label on the left, amount on the right, at least 44 high. */
export function LedgerRow({ label, value }: { label: string; value: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 44 }}>
      <RNText style={[typography.body, { color: p.muted, flexShrink: 1 }]}>{label}</RNText>
      {value}
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
