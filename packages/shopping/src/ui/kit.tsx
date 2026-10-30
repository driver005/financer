import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
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

/**
 * The standard section: a flat strip closed by a hairline, like the finance app. `tone="accent"`
 * is the one boxed variant, a soft tinted block for something to act on.
 */
export function Card({ children, onPress, tone, style }: { children: ReactNode; onPress?: () => void; tone?: "accent"; style?: ViewStyle }) {
  const p = usePalette();
  const base: ViewStyle =
    tone === "accent"
      ? { backgroundColor: p.accentSoft, borderRadius: radius.xl, padding: space.md, gap: space.sm }
      : { borderBottomWidth: 1, borderBottomColor: p.border, paddingBottom: space.md, gap: space.sm };
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={[base, style]}>{children}</View>
  );
}

/**
 * The filled panel at the top of a screen: a label, one big figure and an optional chip. Everything
 * on it is drawn in `onAccent`, so it reads in both themes. One per screen, like the finance app.
 */
export function HeroPanel({ label, chip, children }: { label: string; chip?: ReactNode; children?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ backgroundColor: p.accent, borderRadius: radius.xl, padding: space.lg, gap: space.xs }}>
      <Row between>
        <Text style={[type.small, { color: p.onAccent, opacity: 0.85, fontWeight: "600", flexShrink: 1 }]}>{label}</Text>
        {chip}
      </Row>
      {children}
    </View>
  );
}

/** A small translucent pill on the panel. */
export function PanelChip({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ borderRadius: radius.pill, overflow: "hidden", flexShrink: 1 }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.onAccent, opacity: 0.2 }]} />
      <Text style={[type.small, { color: p.onAccent, fontWeight: "700", paddingHorizontal: space.md, paddingVertical: 4 }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** The big figure of a panel (a price, a count, a name); `suffix` is the small word after it. */
export function PanelValue({ value, suffix, size = 40 }: { value: string; suffix?: string; size?: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" }} accessible accessibilityLabel={suffix ? `${value} ${suffix}` : value}>
      <Text style={{ color: p.onAccent, fontSize: size, lineHeight: Math.round(size * 1.14), fontWeight: "900", fontVariant: ["tabular-nums"], flexShrink: 1 }}>{value}</Text>
      {suffix ? <Text style={[type.body, { color: p.onAccent, opacity: 0.85, fontWeight: "700" }]}>{suffix}</Text> : null}
    </View>
  );
}

/** Secondary text on the panel. */
export function PanelCaption({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <Text style={[type.small, { color: p.onAccent, opacity: 0.85 }]}>{children}</Text>;
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
        backgroundColor: selected ? p.accent : "transparent",
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? p.accent : p.border,
        paddingVertical: 7,
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
      style={{ height, borderRadius: height, backgroundColor: p.border, overflow: "hidden" }}
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

/** Mutually exclusive options: a hairline outline, the chosen segment in the soft accent tint. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const p = usePalette();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: on ? p.accentSoft : "transparent" }}
          >
            <Text style={{ color: on ? p.accent : p.muted, fontSize: 14, fontWeight: on ? "800" : "600" }}>{o.label}</Text>
          </Pressable>
        );
      })}
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
