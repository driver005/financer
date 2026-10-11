import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, useColorScheme, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";

export function useColors() {
  const dark = useColorScheme() === "dark";
  return dark
    ? { bg: "#0f1115", card: "#1a1d24", text: "#f2f4f8", muted: "#9aa3b2", border: "#2a2f3a", accent: "#4ea1ff", bad: "#ff6b6b", good: "#4cd694" }
    : { bg: "#f5f6f8", card: "#ffffff", text: "#14171c", muted: "#5d6675", border: "#e1e4ea", accent: "#0a64d8", bad: "#c62828", good: "#1b8a56" };
}

export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>{children}</View>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[styles.title, { color: c.text }]}>{children}</Text>;
}

export function Body({ children, muted, bold }: { children: ReactNode; muted?: boolean; bold?: boolean }) {
  const c = useColors();
  return <Text style={{ color: muted ? c.muted : c.text, fontSize: 15, fontWeight: bold ? "600" : "400" }}>{children}</Text>;
}

export function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: c.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** Shown on every tab until the server URL and token are saved. */
export function NeedsSetup() {
  const c = useColors();
  return (
    <Card>
      <Body bold>Connect to your server first</Body>
      <Text style={{ color: c.muted, marginTop: 4 }}>Enter the server address and API token in Settings.</Text>
      <Link href="/settings" style={{ color: c.accent, marginTop: 12, fontSize: 16 }}>
        Open Settings
      </Link>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 10 },
  title: { fontSize: 28, fontWeight: "700", marginVertical: 12 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
