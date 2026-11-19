import React, { createContext, useContext, type ReactNode } from "react";
import {
  AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Switch as RNSwitch, Text as RNText,
  TextInput, View, type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { darkTheme, legacyTypography, lightTheme, radius, spacing, typography, type Theme } from "./tokens";

const ThemeContext = createContext<Theme>(lightTheme);

export function FinanceUIProvider({ theme = lightTheme, children }: { theme?: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useFinanceTheme(): Theme { return useContext(ThemeContext); }
export { lightTheme, darkTheme };

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useFinanceTheme();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? theme.text} />;
}

export function Box({ children, style, row, gap }: { children: ReactNode; style?: StyleProp<ViewStyle>; row?: boolean; gap?: number; key?: React.Key }) {
  return <View style={[row && styles.row, gap !== undefined && { gap }, style]}>{children}</View>;
}

export type TextVariant = Exclude<keyof typeof legacyTypography, "font">;

export function Text({ children, variant = "body2", color, style, numberOfLines }: {
  children: ReactNode; variant?: TextVariant; color?: "muted" | "subtle" | "primary" | "accent" | "income" | "expense" | "transfer" | "success" | "danger" | "offer"; style?: StyleProp<TextStyle>; numberOfLines?: number;
}) {
  const theme = useFinanceTheme();
  const tint = color ? (color === "accent" ? theme.secondary : theme[color]) : theme.text;
  return <RNText numberOfLines={numberOfLines} style={[{ fontFamily: variant.startsWith("heading") || variant.startsWith("headline") ? typography.font.display : typography.font.body, color: tint }, legacyTypography[variant], style]}>{children}</RNText>;
}

export function Money({ cents, currency = "EUR", variant = "numericTitle", color, style }: {
  cents: number; currency?: string; variant?: "numericHeading" | "numericTitle" | "numericLarge" | "numericMedium"; color?: "muted" | "primary" | "income" | "expense"; style?: StyleProp<TextStyle>;
}) {
  const theme = useFinanceTheme();
  const value = `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
  return <RNText style={[{ fontFamily: typography.font.number, color: color ? theme[color] : theme.text }, legacyTypography[variant], style]}>{value}</RNText>;
}

export function Card({ children, onPress, style, tone }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; tone?: "primary" | "surface" | "accent" }) {
  const theme = useFinanceTheme();
  const base: StyleProp<ViewStyle> = [styles.card, { backgroundColor: tone === "primary" || tone === "accent" ? theme.primarySoft : theme.surface, borderColor: theme.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }: { pressed: boolean }) => [base, pressed && styles.pressed]}>{children}</Pressable>;
}

export function Button({ label, onPress, variant, tone, icon, disabled }: {
  label: string; onPress: () => void; variant?: "filled" | "outlined" | "secondary" | "tertiary";
  tone?: "accent" | "secondary" | "danger"; icon?: IconName; disabled?: boolean;
}) {
  const theme = useFinanceTheme();
  const resolved = variant ?? (tone === "secondary" ? "secondary" : "filled");
  const filled = resolved === "filled";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.button,
        {
          backgroundColor: filled ? theme.primary : resolved === "secondary" ? theme.surfaceAlt : "transparent",
          borderColor: theme.primary, borderWidth: filled ? 0 : 1,
        },
        pressed && styles.pressed, disabled && styles.disabled,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={filled ? theme.surface : theme.primary} /> : null}
      <RNText style={[legacyTypography.body2, { fontFamily: typography.font.body, color: filled ? theme.surface : theme.primary }]}>{label}</RNText>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  const theme = useFinanceTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <Icon name={icon} color={active ? theme.primary : theme.muted} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const theme = useFinanceTheme();
  const style: StyleProp<ViewStyle> = [styles.chip, { backgroundColor: selected ? theme.primary : theme.surfaceAlt, borderColor: selected ? theme.primary : theme.border }];
  const content = <RNText style={[legacyTypography.body4, { fontFamily: typography.font.body, color: selected ? theme.surface : theme.muted }]}>{label}</RNText>;
  if (!onPress) return <View style={style}>{content}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }: { pressed: boolean }) => [style, pressed && styles.pressed]}>{content}</Pressable>;
}

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "income" | "expense" | "transfer" | "muted" | "offer" | "success" | "danger" | "accent"; key?: React.Key }) {
  const theme = useFinanceTheme();
  const color = tone === "muted" ? theme.muted : tone === "accent" ? theme.primary : theme[tone];
  const background = tone === "offer" ? theme.offerSoft : theme.surfaceAlt;
  return <View style={[styles.badge, { backgroundColor: background, borderColor: theme.border }]}><RNText style={[legacyTypography.body5, { fontFamily: typography.font.body, color, fontWeight: "700" }]}>{label}</RNText></View>;
}

export function TextField({ label, value, onChangeText, placeholder, numeric, multiline, keyboardType }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean; keyboardType?: "default" | "decimal-pad" | "number-pad";
}) {
  const theme = useFinanceTheme();
  return (
    <View style={styles.fieldWrap}>
      <RNText style={[legacyTypography.body4, { fontFamily: typography.font.body, color: theme.muted }]}>{label}</RNText>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.muted}
        multiline={multiline} keyboardType={keyboardType ?? (numeric ? "decimal-pad" : "default")}
        style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text, fontFamily: numeric ? typography.font.number : typography.font.body, minHeight: multiline ? 96 : 48 }]}
      />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      {options.map((option) => (
        <Pressable key={option.value} onPress={() => onChange(option.value)} accessibilityRole="button"
          style={({ pressed }: { pressed: boolean }) => [styles.segment, option.value === value && { backgroundColor: theme.primary }, pressed && styles.pressed]}>
          <RNText style={[legacyTypography.body4, { fontFamily: typography.font.body, color: option.value === value ? theme.surface : theme.muted }]}>{option.label}</RNText>
        </Pressable>
      ))}
    </View>
  );
}

export function Progress({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.progress, { backgroundColor: theme.surfaceAlt, height }]}>
      <View style={[styles.progressFill, { backgroundColor: color ?? theme.primary, width: `${Math.max(0, Math.min(100, value))}%`, height }]} />
    </View>
  );
}

export function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label?: string; key?: React.Key }) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.row}>
      <View style={[styles.checkbox, { borderColor: checked ? theme.primary : theme.border, backgroundColor: checked ? theme.primary : theme.surface }]}>
        {checked ? <Icon name="check" size={14} color={theme.surface} /> : null}
      </View>
      {label ? <Text variant="body3">{label}</Text> : null}
    </Pressable>
  );
}

export function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  const theme = useFinanceTheme();
  return (
    <View style={styles.rowSpace}>
      <Text variant="body2">{label}</Text>
      <RNSwitch value={value} onValueChange={onChange} trackColor={{ true: theme.primary, false: theme.border }} thumbColor={theme.surface} />
    </View>
  );
}

export function EmptyState({ title, message, icon = "inbox-outline", action }: { title: string; message: string; icon?: IconName; action?: { label: string; onPress: () => void } }) {
  const theme = useFinanceTheme();
  return (
    <Card style={styles.center}>
      <Icon name={icon} size={34} color={theme.muted} />
      <Text variant="heading6">{title}</Text>
      <Text variant="body3" color="muted">{message}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.card, { backgroundColor: `${theme.error}12`, borderColor: `${theme.error}55` }]}>
      <Icon name="alert-circle-outline" size={24} color={theme.error} />
      <Text variant="body3" color="expense">{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Compact dashboard tile used by the merged Home and Hub screens. */
export function Tile({ icon, label, onPress, accent }: { icon: IconName; label: string; onPress: () => void; accent?: boolean }) {
  const theme = useFinanceTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [
      styles.tile, { backgroundColor: accent ? theme.primarySoft : theme.surface, borderColor: accent ? theme.primary : theme.border },
      pressed && styles.pressed,
    ]}>
      <Icon name={icon} size={22} color={accent ? theme.primary : theme.muted} />
      <Text variant="body4" color={accent ? "primary" : undefined} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

export function AsyncBoundary({ loading, error, onRetry, rows = 3, children }: {
  loading?: boolean; error?: string | null; onRetry?: () => void; rows?: number; children: ReactNode;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading) return <Skeleton rows={rows} />;
  return <>{children}</>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const theme = useFinanceTheme();
  return <View style={styles.column}>{Array.from({ length: rows }, (_, i) => <View key={i} style={[styles.skeleton, { backgroundColor: theme.surfaceAlt }]} />)}</View>;
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const theme = useFinanceTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
        <View style={styles.rowSpace}><Text variant="heading5">{title}</Text><IconButton icon="close" label="Close" onPress={onClose} /></View>
        <ScrollView>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Divider() { const theme = useFinanceTheme(); return <View style={{ height: 1, backgroundColor: theme.border }} />; }

/** Subtle 240ms entrance. Honours the OS reduced-motion setting. */
export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(8)).current;
  React.useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active) return;
      if (reduced) { opacity.setValue(1); translateY.setValue(0); return; }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 240, delay, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 240, delay, useNativeDriver: true }),
      ]).start();
    });
    return () => { active = false; };
  }, [delay, opacity, translateY]);
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

/** App shell used by every screen. Kept here so there is only one UI kit. */
export function Screen({ title, subtitle, action, back, children }: {
  title: string; subtitle?: string; action?: ReactNode; back?: ReactNode; children: ReactNode;
}) {
  const theme = useFinanceTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.screenHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={{ width: 44 }}>{back}</View>
        <View style={{ flex: 1 }}>
          <Text variant="heading3">{title}</Text>
          {subtitle ? <Text variant="caption" color="muted">{subtitle}</Text> : null}
        </View>
        <View style={{ minWidth: 44, alignItems: "flex-end" }}>{action}</View>
      </View>
      <ScrollView contentContainerStyle={styles.screenContent}>{children}</ScrollView>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.sectionTitle, { borderBottomColor: theme.border }]}>
      <Text variant="heading3">{children}</Text>
      {action}
    </View>
  );
}

/** Compatibility wrapper: same props as the old Empty component. */
export function Empty({ title, message, actionLabel, onAction, icon = "inbox-outline" }: {
  title: string; message: string; actionLabel?: string; onAction?: () => void; icon?: IconName;
}) {
  return <EmptyState title={title} message={message} icon={icon} action={actionLabel && onAction ? { label: actionLabel, onPress: onAction } : undefined} />;
}

/** Compatibility wrapper: same props as the old Loading component. */
export function Loading({ rows = 3 }: { rows?: number }) { return <Skeleton rows={rows} />; }

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" | "muted" }) {
  const theme = useFinanceTheme();
  const color = tone === "error" ? theme.danger : tone === "success" ? theme.success : theme.muted;
  return <Text variant="body3" color={tone === "info" ? "muted" : undefined} style={{ color }}>{children}</Text>;
}

export function Stepper({ value, onChange, min = 1, max = 12 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <Box row gap={12}>
      <IconButton icon="minus" label="Decrease" onPress={() => onChange(Math.max(min, value - 1))} active={value > min} />
      <Text variant="number">{value}</Text>
      <IconButton icon="plus" label="Increase" onPress={() => onChange(Math.min(max, value + 1))} active={value < max} />
    </Box>
  );
}

const styles = StyleSheet.create({
  screenHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, gap: spacing.sm },
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 110 },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.sm, borderBottomWidth: 1, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  column: { gap: spacing.sm },
  rowSpace: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  center: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  card: { borderWidth: 1, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  button: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, borderWidth: 1 },
  fieldWrap: { gap: spacing.sm },
  field: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 15 },
  segmented: { flexDirection: "row", borderRadius: radius.full, borderWidth: 1, padding: spacing.xs },
  segment: { flex: 1, minHeight: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  progress: { borderRadius: radius.full, overflow: "hidden" },
  progressFill: { borderRadius: radius.full },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  tile: { width: "47%", minHeight: 86, borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  skeleton: { height: 56, borderRadius: radius.card },
  backdrop: { flex: 1, backgroundColor: "#00000066" },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: "80%" },
});
