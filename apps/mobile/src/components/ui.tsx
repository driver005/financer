import { Link } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import {
  ActivityIndicator,
  Button as PaperButton,
  Card as PaperCard,
  ProgressBar,
  Text,
  useTheme,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

/** Colours used by the screens, taken from the active Paper (Material 3) theme. */
export function useColors() {
  const { colors, dark } = useTheme();
  return {
    bg: colors.background,
    card: colors.surface,
    text: colors.onSurface,
    muted: colors.onSurfaceVariant,
    border: colors.outlineVariant,
    accent: colors.primary,
    bad: colors.error,
    good: dark ? "#7fd9a8" : "#1b6b4a",
  };
}

export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <View style={styles.screen}>{children}</View>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <PaperCard mode="contained" style={[styles.card, style]}>
      <PaperCard.Content>{children}</PaperCard.Content>
    </PaperCard>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text variant="headlineMedium" style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, bold }: { children: ReactNode; muted?: boolean; bold?: boolean }) {
  const c = useColors();
  return (
    <Text variant="bodyLarge" style={{ color: muted ? c.muted : c.text, fontWeight: bold ? "600" : "400" }}>
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
    <PaperButton mode={mode} icon={icon} onPress={onPress} disabled={disabled} style={styles.button}>
      {label}
    </PaperButton>
  );
}

/**
 * Progress bar with a fixed 4px box. Paper's ProgressBar wraps itself in `height: 100%` on
 * web, which grows inside a flex column and pushes the content below it far away.
 */
export function Bar({ progress, color, marginTop = 6 }: { progress: number; color?: string; marginTop?: number }) {
  const c = useColors();
  return (
    <View style={{ height: 4, marginTop, borderRadius: 4, overflow: "hidden" }}>
      <ProgressBar progress={Math.max(0, Math.min(1, progress))} color={color ?? c.accent} />
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

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  card: { marginBottom: 10 },
  title: { fontWeight: "700", marginVertical: 12 },
  button: { borderRadius: 12 },
});
