/**
 * Finanzguru (de.dwins.financeguru) screen components.
 * Faithful to the four Play Store screenshots — deep indigo #3C318F,
 * off-white #F2F1F6 canvas, white rounded cards, navy #2A2166 ink,
 * mint #C9F2DC pills and violet #7B3FE4 accents.
 * Part of the single @finance/ui kit; no separate design system.
 */
import React, { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Box, Icon, Text, type IconName, useFinanceTheme } from "./primitives";
import { palette, radius, spacing, typography } from "./tokens";

const de = (cents: number, decimals = true) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(cents / 100);

export const fgEuro = (cents: number, decimals = true) => `${de(cents, decimals)} €`;

/** Big page title + trailing action icons, as on the store Overview/Contracts screens. */
export function FgHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const theme = useFinanceTheme();
  return (
    <View style={styles.header}>
      <RNText style={[styles.headerTitle, { color: theme.text, fontFamily: typography.font.display }]}>{title}</RNText>
      <View style={styles.headerActions}>{actions}</View>
    </View>
  );
}

/** Screen shell with the Finanzguru header and off-white scrolling content. */
export function FgScreen({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const theme = useFinanceTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <FgHeader title={title} actions={actions} />
        {children}
      </ScrollView>
    </View>
  );
}

export function FgSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text variant="heading3">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function FgLink({ label, onPress }: { label: string; onPress?: () => void }) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} disabled={!onPress}>
      <RNText style={[styles.link, { color: theme.income, fontFamily: typography.font.body }]}>{`${label} ›`}</RNText>
    </Pressable>
  );
}

/** Purple salary card from the store Overview: Plus badge, payday, available amount, progress. */
export function FgStatCard({ availableCents, daysUntilPayday = 16, progress = 0.68, onPress }: {
  availableCents: number; daysUntilPayday?: number; progress?: number; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={styles.statCard}>
      <View style={styles.statTop}>
        <View style={styles.plusBadge}><RNText style={styles.plusText}>Plus</RNText></View>
        <RNText style={styles.statLabel}>Statistics</RNText>
        <View style={{ flex: 1 }} />
        <RNText style={styles.payday}>{`${daysUntilPayday} days until payday ›`}</RNText>
      </View>
      <RNText style={[styles.statAmount, { fontFamily: typography.font.number }]}>{fgEuro(availableCents, false)}</RNText>
      <RNText style={styles.statCaption}>available from salary</RNText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress * 100))}%` }]} />
      </View>
    </Pressable>
  );
}

/** Small circular budget dial with an emoji centre, as in the Budgets strip. */
export function FgBudgetRing({ emoji, progress, color = palette.accent, onPress }: {
  emoji: string; progress: number; color?: string; onPress?: () => void;
}) {
  const size = 46;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const length = Math.max(0, Math.min(1, progress)) * circumference;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.budgetRing}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#EAE7F3" strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${length} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="round" />
      </Svg>
      <RNText style={styles.budgetEmoji}>{emoji}</RNText>
    </Pressable>
  );
}

/** White card row with emoji logo, label and right-aligned amount. */
export function FgAccountRow({ emoji, name, cents, onPress }: { emoji: string; name: string; cents: number; onPress?: () => void }) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.accountRow, { borderBottomColor: theme.border }]}>
      <View style={[styles.logoBox, { backgroundColor: theme.background }]}><RNText style={styles.logoEmoji}>{emoji}</RNText></View>
      <Text variant="body2" style={styles.accountName}>{name}</Text>
      <RNText style={[styles.accountAmount, { fontFamily: typography.font.number, color: cents < 0 ? theme.expense : theme.income }]}>
        {fgEuro(cents)}
      </RNText>
    </Pressable>
  );
}

/** Merchant row used on Contracts and Automatically categorised screens. */
export function FgMerchantRow({ emoji, name, category, cents, logoColor, pill, onPress }: {
  emoji: string; name: string; category?: string; cents?: number; logoColor?: string; pill?: ReactNode; onPress?: () => void;
}) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.merchantRow, { borderBottomColor: theme.border }]}>
      <View style={[styles.merchantLogo, { backgroundColor: logoColor ?? theme.background }]}><RNText style={styles.merchantEmoji}>{emoji}</RNText></View>
      <View style={styles.merchantBody}>
        <Text variant="body2" style={styles.merchantName}>{name}</Text>
        {category ? <Text variant="caption" color="muted">{category}</Text> : null}
      </View>
      {pill}
      {cents !== undefined ? (
        <RNText style={[styles.merchantAmount, { fontFamily: typography.font.number, color: theme.text }]}>{fgEuro(cents)}</RNText>
      ) : null}
    </Pressable>
  );
}

/** Mint "Internet & Phone ✓" style category pill. */
export function FgCategoryPill({ label }: { label: string }) {
  return (
    <View style={styles.categoryPill}>
      <RNText style={[styles.categoryPillText, { fontFamily: typography.font.body }]}>{label}</RNText>
      <Icon name="check" size={14} color={palette.mintText} />
    </View>
  );
}

/** Floating white category chip with emoji, as on Automatically categorised. */
export function FgCategoryChip({ emoji, label, align = "center" }: { emoji: string; label: string; align?: "left" | "center" | "right" }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.categoryChip, { backgroundColor: theme.surface, alignSelf: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center" }]}>
      <RNText style={styles.chipEmoji}>{emoji}</RNText>
      <RNText style={[styles.chipLabel, { color: theme.text, fontFamily: typography.font.body }]}>{label}</RNText>
    </View>
  );
}

/** White circular bank logo used on the Connect accounts onboarding. */
export function FgBankCircle({ emoji, color, size = 96, style }: { emoji: string; color?: string; size?: number; style?: object }) {
  return (
    <View style={[styles.bankCircle, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <RNText style={[styles.bankEmoji, { fontSize: size * 0.4, color }]}>{emoji}</RNText>
    </View>
  );
}

/** Full-bleed indigo onboarding shell with the bold white Connect headline. */
export function FgOnboarding({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.onboarding}>
      <RNText style={[styles.onboardingTitle, { fontFamily: typography.font.display }]}>{title}</RNText>
      {children}
    </View>
  );
}

export function FgTipsRow({ count, onPress }: { count: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.tipsRow}>
      <Icon name="star" size={18} color={palette.accent} />
      <Text variant="body2" style={styles.tipsText}>{`${count} money-saving tips for you`}</Text>
      <Icon name="chevron-right" size={18} color={palette.accent} />
    </Pressable>
  );
}

export function FgSortButton({ label, onPress }: { label: string; onPress?: () => void }) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.sortButton, { backgroundColor: theme.surfaceAlt }]}>
      <RNText style={[styles.sortText, { color: theme.text, fontFamily: typography.font.body }]}>{label}</RNText>
      <Icon name="sort" size={16} color={theme.text} />
    </Pressable>
  );
}

export function FgHeaderIcon({ name, onPress, label }: { name: IconName; onPress?: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.headerIcon}>
      <Icon name={name} size={22} color={palette.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  headerTitle: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  section: { gap: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { fontSize: 14, fontWeight: "600" },
  statCard: { backgroundColor: palette.primary, borderRadius: 18, padding: 18, gap: 4 },
  statTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  plusBadge: { backgroundColor: palette.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  plusText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  statLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  payday: { color: palette.mint, fontSize: 12 },
  statAmount: { color: "#FFFFFF", fontSize: 34, fontWeight: "700", marginTop: 8 },
  statCaption: { color: "#D9D5F2", fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#5B4FB5", marginTop: 10, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: palette.mint },
  budgetRing: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  budgetEmoji: { position: "absolute", fontSize: 18 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  logoBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logoEmoji: { fontSize: 20 },
  accountName: { flex: 1 },
  accountAmount: { fontSize: 15, fontWeight: "600" },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  merchantLogo: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  merchantEmoji: { fontSize: 22 },
  merchantBody: { flex: 1, gap: 2 },
  merchantName: { fontWeight: "600" },
  merchantAmount: { fontSize: 15, fontWeight: "600" },
  categoryPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.mint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  categoryPillText: { color: palette.mintText, fontSize: 13, fontWeight: "600" },
  categoryChip: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, shadowColor: "#2A2166", shadowOpacity: 0.12, shadowRadius: 12, elevation: 4 },
  chipEmoji: { fontSize: 22 },
  chipLabel: { fontSize: 17, fontWeight: "700" },
  bankCircle: { position: "absolute", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#1B144F", shadowOpacity: 0.18, shadowRadius: 14, elevation: 6 },
  bankEmoji: { fontWeight: "700" },
  onboarding: { flex: 1, backgroundColor: palette.primary, paddingHorizontal: 24, paddingTop: 80, alignItems: "center" },
  onboardingTitle: { color: "#FFFFFF", fontSize: 38, fontWeight: "700", textAlign: "center", lineHeight: 44 },
  tipsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.card },
  tipsText: { flex: 1, color: palette.accent, fontWeight: "600" },
  sortButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  sortText: { fontSize: 15, fontWeight: "600" },
});
