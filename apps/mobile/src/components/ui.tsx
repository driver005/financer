import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Button as HButton, Card as HCard } from "heroui-native";
import type { ComponentProps, ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActivityIndicator, Text } from "@/components/kit";
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
    <HCard className="mb-2.5 rounded-2xl" style={style}>
      <HCard.Body>{children}</HCard.Body>
    </HCard>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text variant="headlineMedium" style={{ marginVertical: 12 }} accessibilityRole="header">
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

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

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
  const p = usePalette();
  const variant = mode === "contained" ? "primary" : mode === "outlined" ? "outline" : mode === "text" ? "ghost" : "secondary";
  return (
    <HButton variant={variant} onPress={onPress} isDisabled={disabled} className="rounded-xl" accessibilityLabel={label}>
      {icon ? (
        <MaterialCommunityIcons name={icon as IconName} size={18} color={variant === "primary" ? "#ffffff" : p.text} />
      ) : null}
      <HButton.Label>{label}</HButton.Label>
    </HButton>
  );
}

/** Thin progress bar. `progress` is 0..1; `color` overrides the accent. */
export function Bar({ progress, color, marginTop = 6 }: { progress: number; color?: string; marginTop?: number }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <View
      className="h-1.5 overflow-hidden rounded-full bg-default"
      style={{ marginTop }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: color ?? c.accent }} />
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
