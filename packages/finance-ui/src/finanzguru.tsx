/**
 * Finanzguru (de.dwins.financeguru) screen components.
 * Stitch "Pantry Playful" design system — bright green #58CC02,
 * chalk canvas, white rounded cards, ink #3C3C3C and mint #D7FFB8 accents.
 * Part of the single @finance/ui kit; no separate design system.
 */
import React, { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Box, Card, Icon, Text, type IconName, useFinanceTheme } from "./primitives";
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
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#D7FFB8" strokeWidth={stroke} fill="none" />
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

/** Horizontal category bar from the Budgets store screenshot. */
export function FgBudgetBar({ emoji, label, cents, maxCents, color }: {
  emoji: string; label: string; cents: number; maxCents: number; color?: string;
}) {
  const width = maxCents > 0 ? Math.max(4, Math.min(100, (cents / maxCents) * 100)) : 0;
  return (
    <Box row gap={10} style={styles.budgetBarRow}>
      <RNText style={styles.budgetBarEmoji}>{emoji}</RNText>
      <View style={[styles.budgetBarTrack, { backgroundColor: color ?? palette.primary }]}>
        <View style={[styles.budgetBarFill, { width: `${width}%` }]} />
        <RNText style={styles.budgetBarAmount}>{fgEuro(cents, false)}</RNText>
      </View>
      <RNText style={styles.budgetBarLabel}>{label}</RNText>
    </Box>
  );
}

/** Budget card with left/over budget status and a progress bar (store Budgets screen). */
export function FgBudgetCard({ emoji, label, leftCents, progress, onPress }: {
  emoji: string; label: string; leftCents: number; progress: number; onPress?: () => void;
}) {
  const over = leftCents < 0;
  const color = over ? "#FF9600" : palette.success;
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.budgetCard, { borderColor: `${color}44` }]}>
      <Box row gap={12}>
        <RNText style={styles.budgetCardEmoji}>{emoji}</RNText>
        <View style={{ flex: 1 }}>
          <Text variant="heading5">{label}</Text>
          <RNText style={[styles.budgetStatus, { color }]}>
            {over ? `${fgEuro(Math.abs(leftCents), false)} over budget` : `${fgEuro(leftCents, false)} left`}
          </RNText>
        </View>
      </Box>
      <View style={styles.budgetProgressTrack}>
        <View style={[styles.budgetProgressFill, { width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

/** Savings Booster points card with coin, euro value and cash-out row (store Cashback screen). */
export function FgPointsCard({ points, euroCents, progress = 1, onCashOut }: {
  points: number; euroCents: number; progress?: number; onCashOut?: () => void;
}) {
  return (
    <Card style={styles.pointsCard}>
      <Box row gap={12} style={{ alignItems: "center" }}>
        <View style={styles.coin}><Icon name="circle-multiple" size={26} color={palette.accent} /></View>
        <RNText style={[styles.pointsValue, { fontFamily: typography.font.number }]}>{points.toLocaleString("de-DE")}</RNText>
        <RNText style={styles.pointsUnit}>Points</RNText>
        <View style={{ flex: 1 }} />
        <RNText style={styles.pointsEuro}>{`Equals ${fgEuro(euroCents)}`}</RNText>
      </Box>
      <View style={styles.pointsTrack}><View style={[styles.pointsFill, { width: `${Math.max(2, Math.min(100, progress * 100))}%` }]} /></View>
      <Pressable onPress={onCashOut} accessibilityRole="button" style={styles.cashOutRow}>
        <Text variant="body2" style={styles.cashOutText}>You can cash out your points 🎉</Text>
        <Icon name="chevron-right" size={18} color={palette.inkSubtle} />
      </Pressable>
    </Card>
  );
}

/** Voucher row from the Savings Booster store screenshot. */
export function FgVoucherRow({ store, amountCents, emoji = "🎟️", onPress }: {
  store: string; amountCents: number; emoji?: string; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.voucherRow, { borderColor: palette.border }]}>
      <View style={styles.voucherLogo}><RNText style={styles.voucherEmoji}>{emoji}</RNText></View>
      <Text variant="body2" style={{ flex: 1 }}>{store}</Text>
      <Text variant="body2" color="income">{fgEuro(amountCents)}</Text>
    </Pressable>
  );
}

/** Purple "Missed cashback" pill on transaction rows. */
export function FgCashbackPill({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.cashbackPill}>
      <RNText style={[styles.cashbackPillText, { fontFamily: typography.font.body }]}>Missed cashback</RNText>
    </Pressable>
  );
}

/** Green "Cancelled!" badge from the cancellation store screenshot. */
export function FgCancelledBadge() {
  return (
    <View style={styles.cancelledBadge}><RNText style={styles.cancelledText}>Cancelled!</RNText></View>
  );
}

/** Date section header used by the All Transactions screen. */
export function FgDateHeader({ label, right, highlight }: { label: string; right?: string; highlight?: boolean }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.dateHeader, highlight && { backgroundColor: palette.primary }]}>
      <Text variant="body3" style={{ color: highlight ? "#FFFFFF" : theme.muted }}>{label}</Text>
      {right ? <Text variant="body3" color={highlight ? undefined : "income"} style={highlight ? { color: palette.mint } : undefined}>{right}</Text> : null}
    </View>
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
  headerTitle: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  section: { gap: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { fontSize: 14, fontWeight: "700" },
  statCard: { backgroundColor: palette.primary, borderRadius: 18, padding: 18, gap: 4 },
  statTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  plusBadge: { backgroundColor: palette.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  plusText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  statLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  payday: { color: palette.mint, fontSize: 12 },
  statAmount: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", marginTop: 8 },
  statCaption: { color: "#EAFFD8", fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#46A302", marginTop: 10, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: palette.mint },
  budgetRing: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  budgetEmoji: { position: "absolute", fontSize: 18 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  logoBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logoEmoji: { fontSize: 20 },
  accountName: { flex: 1 },
  accountAmount: { fontSize: 15, fontWeight: "700" },
  merchantRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  merchantLogo: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  merchantEmoji: { fontSize: 22 },
  merchantBody: { flex: 1, gap: 2 },
  merchantName: { fontWeight: "700" },
  merchantAmount: { fontSize: 15, fontWeight: "700" },
  categoryPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.mint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  categoryPillText: { color: palette.mintText, fontSize: 13, fontWeight: "700" },
  categoryChip: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, shadowColor: "#3C3C3C", shadowOpacity: 0.12, shadowRadius: 12, elevation: 4 },
  chipEmoji: { fontSize: 22 },
  chipLabel: { fontSize: 17, fontWeight: "800" },
  bankCircle: { position: "absolute", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#3C3C3C", shadowOpacity: 0.18, shadowRadius: 14, elevation: 6 },
  bankEmoji: { fontWeight: "800" },
  onboarding: { flex: 1, backgroundColor: palette.primary, paddingHorizontal: 24, paddingTop: 80, alignItems: "center" },
  onboardingTitle: { color: "#FFFFFF", fontSize: 38, fontWeight: "800", textAlign: "center", lineHeight: 44 },
  tipsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.card },
  tipsText: { flex: 1, color: palette.accent, fontWeight: "700" },
  sortButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  sortText: { fontSize: 15, fontWeight: "700" },
  budgetBarRow: { alignItems: "center" },
  budgetBarEmoji: { fontSize: 24, width: 30, textAlign: "center" },
  budgetBarTrack: { height: 34, borderRadius: 10, justifyContent: "center", paddingHorizontal: 12, minWidth: 80, maxWidth: 250 },
  budgetBarFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#FFFFFF33", borderRadius: 10 },
  budgetBarAmount: { color: "#FFFFFF", fontFamily: typography.font.number, fontSize: 16, fontWeight: "800", textAlign: "right" },
  budgetBarLabel: { flex: 1, fontSize: 14, color: palette.ink },
  budgetCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  budgetCardEmoji: { fontSize: 30, width: 38, textAlign: "center" },
  budgetStatus: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  budgetProgressTrack: { height: 8, borderRadius: 4, backgroundColor: "#D7FFB8", overflow: "hidden" },
  budgetProgressFill: { height: 8, borderRadius: 4 },
  pointsCard: { gap: 12 },
  coin: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#D7FFB8", alignItems: "center", justifyContent: "center" },
  pointsValue: { color: palette.accent, fontSize: 30, fontWeight: "800" },
  pointsUnit: { color: palette.ink, fontSize: 16, fontWeight: "700", marginTop: 7 },
  pointsEuro: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  pointsTrack: { height: 8, borderRadius: 4, backgroundColor: "#D7FFB8", overflow: "hidden" },
  pointsFill: { height: 8, borderRadius: 4, backgroundColor: palette.accent },
  cashOutRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cashOutText: { color: palette.inkMuted },
  voucherRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 10 },
  voucherLogo: { width: 46, height: 46, borderRadius: 10, backgroundColor: "#FFC800", alignItems: "center", justifyContent: "center" },
  voucherEmoji: { fontSize: 22 },
  cashbackPill: { backgroundColor: "#F3E8FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  cashbackPillText: { color: palette.accent, fontSize: 12, fontWeight: "700" },
  cancelledBadge: { backgroundColor: "#58CC02", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, alignSelf: "flex-start" },
  cancelledText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  dateHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
});
