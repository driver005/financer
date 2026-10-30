import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radius, scoreTone, space, type, usePalette } from "./theme";

export function Screen({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const p = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.background }} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: space.lg, gap: space.md }}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Title({ children, onBack, right }: { children: string; onBack?: () => void; right?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12}>
          <Text style={{ color: p.accent, fontSize: 28, lineHeight: 30 }}>‹</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" style={[type.title, { color: p.text, flex: 1 }]}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function H2({ children }: { children: string }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="header" style={[type.heading, { color: p.text, marginTop: space.sm }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, small }: { children: ReactNode; muted?: boolean; small?: boolean }) {
  const p = usePalette();
  return <Text style={[small ? type.small : type.body, { color: muted ? p.muted : p.text }]}>{children}</Text>;
}

export function Card({ children, onPress, tone, style }: { children: ReactNode; onPress?: () => void; tone?: "accent"; style?: ViewStyle }) {
  const p = usePalette();
  const base: ViewStyle = {
    backgroundColor: tone === "accent" ? p.tint : p.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: p.border,
    padding: space.md,
    gap: space.sm,
  };
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={[base, style]}>{children}</View>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
}) {
  const p = usePalette();
  const bg = kind === "primary" ? p.accent : kind === "danger" ? p.bad : "transparent";
  const fg = kind === "primary" ? p.onAccent : kind === "danger" ? p.onAccent : p.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: radius.md,
        borderWidth: kind === "secondary" ? 1 : 0,
        borderColor: p.border,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.sm,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, tone }: { label: string; selected?: boolean; onPress?: () => void; tone?: "good" | "warn" | "bad" }) {
  const p = usePalette();
  const color = tone ? p[tone] : selected ? p.onAccent : p.text;
  const content = (
    <View
      style={{
        backgroundColor: selected ? p.accent : p.surfaceAlt,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? p.accent : p.border,
        paddingVertical: 6,
        paddingHorizontal: space.md,
      }}
    >
      <Text style={{ color, fontSize: 13, fontWeight: "500" }}>{label}</Text>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function Row({ children, wrap, between }: { children: ReactNode; wrap?: boolean; between?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: wrap ? "wrap" : "nowrap", justifyContent: between ? "space-between" : "flex-start" }}>
      {children}
    </View>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.small, { color: p.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[
          { backgroundColor: p.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, color: p.text, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 15 },
          props.multiline ? { minHeight: 140, textAlignVertical: "top" } : null,
          props.style,
        ]}
      />
    </View>
  );
}

/** A horizontal bar for a 0..1 value, or a percentage when `value` is already 0..100. */
export function Meter({ value, tone, height = 8, label }: { value: number; tone?: "good" | "warn" | "bad" | "accent"; height?: number; label?: string }) {
  const p = usePalette();
  const v = Math.min(1, Math.max(0, value));
  const color = tone === "accent" || !tone ? p.accent : p[tone];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height, borderRadius: height, backgroundColor: p.tint, overflow: "hidden" }}
    >
      <View style={{ width: `${v * 100}%`, height, backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function ScoreBar({ score, label, value }: { score: number | null; label: string; value?: string | null }) {
  const p = usePalette();
  const tone = scoreTone(score);
  return (
    <View style={{ gap: 3 }}>
      <Row between>
        <Text style={[type.small, { color: p.text, flex: 1 }]}>{label}</Text>
        <Text style={[type.small, { color: p.muted }]}>{value ?? "unknown"}</Text>
      </Row>
      <Meter value={score ?? 0} tone={tone === "none" ? undefined : tone} height={6} label={label} />
    </View>
  );
}

export function Banner({ children, tone = "info", action }: { children: ReactNode; tone?: "info" | "warn" | "bad"; action?: ReactNode }) {
  const p = usePalette();
  const color = tone === "bad" ? p.bad : tone === "warn" ? p.warn : p.accent;
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: color, backgroundColor: p.surfaceAlt, padding: space.md, gap: space.sm }}>
      {typeof children === "string" ? <Text style={[type.body, { color: p.text }]}>{children}</Text> : children}
      {action}
    </View>
  );
}

export function Empty({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
      <Text accessibilityRole="header" style={[type.heading, { color: p.text, textAlign: "center" }]}>
        {title}
      </Text>
      {message ? <Text style={[type.body, { color: p.muted, textAlign: "center", maxWidth: 320 }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", backgroundColor: p.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, padding: 2 }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={{ flex: 1, paddingVertical: space.sm, alignItems: "center", borderRadius: radius.sm, backgroundColor: o.value === value ? p.accent : "transparent" }}
        >
          <Text style={{ color: o.value === value ? p.onAccent : p.text, fontSize: 13, fontWeight: "600" }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Problems({ items }: { items: string[] }) {
  const p = usePalette();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      {items.map((m) => (
        <Text key={m} style={[type.small, { color: p.bad }]}>
          • {m}
        </Text>
      ))}
    </View>
  );
}
