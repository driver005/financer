import React, { type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText,
  TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { tokens, useTheme, type Colors } from "./theme";

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Screen({ title, action, children, back, subtitle }: {
  title: string; action?: ReactNode; children: ReactNode; back?: ReactNode; subtitle?: string;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>{back}</View>
        <View style={styles.headerText}>
          <RNText style={[styles.title, { color: colors.text }]}>{title}</RNText>
          {subtitle ? <RNText style={[styles.caption, { color: colors.subtle }]}>{subtitle}</RNText> : null}
        </View>
        <View style={styles.headerRight}>{action}</View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, onPress, tone }: { children: ReactNode; onPress?: () => void; tone?: "accent" | "plain" }) {
  const { colors } = useTheme();
  const style: StyleProp<ViewStyle> = [styles.card, { backgroundColor: tone === "accent" ? colors.accentSoft : colors.surface, borderColor: colors.border }];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function Button({ label, onPress, tone = "accent", disabled, icon }: {
  label: string; onPress: () => void; tone?: "accent" | "secondary" | "danger"; disabled?: boolean; icon?: IconName;
}) {
  const { colors } = useTheme();
  const background = disabled ? colors.border : tone === "accent" ? colors.accent : tone === "danger" ? colors.danger : colors.surface;
  const foreground = disabled ? colors.subtle : tone === "secondary" ? colors.text : colors.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: colors.border }, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size="sm" color={foreground} /> : null}
      <RNText style={[styles.buttonLabel, { color: foreground }]}>{label}</RNText>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, disabled }: { icon: IconName; onPress: () => void; label: string; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Icon name={icon} size="md" color={disabled ? colors.subtle : colors.text} />
    </Pressable>
  );
}

export function Icon({ name, size = "md", color }: { name: IconName; size?: "sm" | "md" | "lg"; color?: string }) {
  const { colors } = useTheme();
  const px = size === "sm" ? 18 : size === "lg" ? 28 : 22;
  return <MaterialCommunityIcons name={name} size={px} color={color ?? colors.text} />;
}

type TextVariant = "caption" | "label" | "body" | "subheading" | "titleLarge" | "number" | "price";

export function Text({ children, variant = "body", color, numberOfLines, style }: {
  children: ReactNode; variant?: TextVariant; color?: "muted" | "subtle" | "accent" | "danger" | "success"; numberOfLines?: number; style?: StyleProp<import("react-native").TextStyle>;
}) {
  const { colors } = useTheme();
  const tint = color ? colors[color] : colors.text;
  return <RNText numberOfLines={numberOfLines} style={[styles[variant], { color: tint }, style]}>{children}</RNText>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <RNText style={[styles.chipLabel, { color: selected ? colors.accentText : colors.muted }]}>{label}</RNText>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [
            styles.segment,
            option.value === value && { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <RNText style={[styles.segmentLabel, { color: option.value === value ? colors.accentText : colors.muted }]}>{option.label}</RNText>
        </Pressable>
      ))}
    </View>
  );
}

export function TextField({ label, value, onChangeText, placeholder, keyboardType, multiline, error }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  keyboardType?: KeyboardTypeOptions; multiline?: boolean; error?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.fieldWrap}>
      <RNText style={[styles.fieldLabel, { color: colors.muted }]}>{label}</RNText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border, color: colors.text, minHeight: multiline ? 96 : tokens.minTouch, textAlignVertical: multiline ? "top" : "center" }]}
      />
      {error ? <RNText style={[styles.caption, { color: colors.danger }]}>{error}</RNText> : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <RNText style={[styles.subheading, { color: colors.text }]}>{children}</RNText>
      {action}
    </View>
  );
}

export function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  const { colors } = useTheme();
  return (
    <Card>
      <RNText style={[styles.statValue, { color: colors.text }]}>{value}</RNText>
      <RNText style={[styles.fieldLabel, { color: colors.muted }]}>{label}</RNText>
      {caption ? <RNText style={[styles.caption, { color: colors.subtle }]}>{caption}</RNText> : null}
    </Card>
  );
}

export function Empty({ title, message, actionLabel, onAction, icon = "inbox-outline" }: {
  title: string; message: string; actionLabel?: string; onAction?: () => void; icon?: IconName;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={styles.empty}>
        <Icon name={icon} size="lg" color={colors.subtle} />
        <RNText style={[styles.subheading, { color: colors.text, textAlign: "center" }]}>{title}</RNText>
        <RNText style={[styles.body, { color: colors.muted, textAlign: "center" }]}>{message}</RNText>
        {actionLabel && onPress(onAction) ? <Button label={actionLabel} onPress={onAction!} /> : null}
      </View>
    </Card>
  );
}

function onPress(fn?: () => void): boolean {
  return typeof fn === "function";
}

export function Loading({ rows = 3 }: { rows?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.column}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: colors.skeleton }]} />
      ))}
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.checkbox}>
      <View style={[styles.checkboxBox, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accent : colors.surface }]}>
        {checked ? <MaterialCommunityIcons name="check" size={16} color={colors.accentText} /> : null}
      </View>
      {label ? <RNText style={[styles.body, { color: colors.text }]}>{label}</RNText> : null}
    </Pressable>
  );
}

export function Badge({ label, tone }: { label: string; tone?: "accent" | "success" | "danger" | "offer" }) {
  const { colors } = useTheme();
  const background = tone === "offer" ? colors.offerSoft : tone === "success" ? colors.surface : tone === "danger" ? colors.surface : colors.accentSoft;
  const foreground = tone === "offer" ? colors.offer : tone === "success" ? colors.success : tone === "danger" ? colors.danger : colors.accent;
  return (
    <View style={[styles.badge, { backgroundColor: background, borderColor: colors.border }]}>
      <RNText style={[styles.caption, { color: foreground, fontWeight: "700" }]}>{label}</RNText>
    </View>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" | "muted" }) {
  const { colors } = useTheme();
  const color = tone === "error" ? colors.danger : tone === "success" ? colors.success : colors.muted;
  return <RNText style={[styles.body, { color }]}>{children}</RNText>;
}

export function Stepper({ value, onChange, min = 1, max = 12 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="minus" label="Decrease" onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} />
      <RNText style={styles.stepperValue}>{value}</RNText>
      <IconButton icon="plus" label="Increase" onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} />
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.md, paddingVertical: tokens.sm, borderBottomWidth: 1, gap: tokens.sm },
  headerLeft: { minWidth: 44 },
  headerRight: { minWidth: 44, alignItems: "flex-end" },
  headerText: { flex: 1 },
  content: { padding: tokens.md, gap: tokens.lg, paddingBottom: 110 },
  title: { fontSize: tokens.font.subheading, fontFamily: tokens.serif, fontWeight: "600", letterSpacing: -0.01 },
  caption: { fontSize: tokens.font.caption, fontFamily: tokens.sans, letterSpacing: 0.01 },
  label: { fontSize: tokens.font.label, fontFamily: tokens.sans },
  body: { fontSize: tokens.font.body, fontFamily: tokens.sans, lineHeight: 21 },
  subheading: { fontSize: tokens.font.subheading, fontFamily: tokens.serif, fontWeight: "600" },
  titleLarge: { fontSize: tokens.font.title, fontFamily: tokens.serif, fontWeight: "600", letterSpacing: -0.01 },
  number: { fontSize: tokens.font.number, fontFamily: tokens.serif, fontWeight: "600" },
  price: { fontSize: tokens.font.body, fontFamily: tokens.sans, fontWeight: "600" },
  column: { gap: tokens.sm },
  card: {
    borderWidth: 1, borderRadius: tokens.radius.card, padding: 18, gap: tokens.sm,
    shadowColor: "#2F7D5D", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10,
    elevation: 2,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  button: { minHeight: tokens.minTouch, borderRadius: tokens.radius.pill, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 20, gap: tokens.sm },
  buttonLabel: { fontSize: tokens.font.body, fontFamily: tokens.sans, fontWeight: "600" },
  iconButton: { width: tokens.minTouch, height: tokens.minTouch, borderRadius: tokens.radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: tokens.radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontSize: tokens.font.label, fontWeight: "500" },
  segmented: { flexDirection: "row", borderRadius: tokens.radius.pill, borderWidth: 1, padding: tokens.xs, gap: tokens.xs },
  segment: { flex: 1, minHeight: 38, borderRadius: tokens.radius.pill, alignItems: "center", justifyContent: "center" },
  segmentLabel: { fontSize: tokens.font.label, fontWeight: "600" },
  fieldWrap: { gap: tokens.xs },
  fieldLabel: { fontSize: tokens.font.label, fontWeight: "600" },
  field: { borderWidth: 1, borderRadius: tokens.radius.md, paddingHorizontal: tokens.md, fontSize: tokens.font.body },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: tokens.sm },
  statValue: { fontSize: tokens.font.number, fontWeight: "700" },
  empty: { alignItems: "center", gap: tokens.md, paddingVertical: tokens.lg },
  skeleton: { height: 64, borderRadius: tokens.radius.md },
  checkbox: { flexDirection: "row", alignItems: "center", gap: tokens.sm, minHeight: tokens.minTouch },
  checkboxBox: { width: 26, height: 26, borderWidth: 2, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badge: { borderWidth: 1, borderRadius: tokens.radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  stepper: { flexDirection: "row", alignItems: "center", gap: tokens.md },
  stepperValue: { fontSize: tokens.font.subheading, fontWeight: "700", minWidth: 28, textAlign: "center" },
  divider: { height: 1 },
});
