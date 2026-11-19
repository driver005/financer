import React from "react";
import { Pressable, StyleSheet, Text as RNText, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Badge, Box, Card, Icon, Money, Text, type IconName, useFinanceTheme } from "./primitives";
import { palette, radius, spacing, typography } from "./tokens";

export type FinanceTransaction = {
  id: string | number;
  title: string;
  amountCents: number;
  kind: "income" | "expense" | "transfer";
  category: string;
  date: string;
  icon?: IconName;
  wallet?: string;
};

/** Pockaw balance card with income/expense cash-flow deltas. */
export function BalanceCard({ balanceCents, incomeCents, expenseCents, incomeDelta, expenseDelta, wallet, onWalletPress, onToggleVisibility, hidden }: {
  balanceCents: number; incomeCents: number; expenseCents: number; incomeDelta?: number; expenseDelta?: number;
  wallet?: string; onWalletPress?: () => void; onToggleVisibility?: () => void; hidden?: boolean;
}) {
  const theme = useFinanceTheme();
  return (
    <Card style={styles.balanceCard}>
      <Box row style={{ justifyContent: "space-between" }}>
        <Pressable onPress={onWalletPress} accessibilityRole="button" style={styles.row}>
          <Text variant="body3" color="muted">{wallet ?? "Total balance"}</Text>
          <Icon name="chevron-down" size={16} color={theme.muted} />
        </Pressable>
        <Pressable onPress={onToggleVisibility} accessibilityRole="button"><Icon name={hidden ? "eye-off" : "eye"} size={18} color={theme.muted} /></Pressable>
      </Box>
      <Money cents={hidden ? 0 : balanceCents} variant="numericHeading" />
      <Box row gap={spacing.md}>
        <CashFlowCard label="Income" cents={incomeCents} delta={incomeDelta} tone="income" hidden={hidden} />
        <CashFlowCard label="Expense" cents={expenseCents} delta={expenseDelta} tone="expense" hidden={hidden} />
      </Box>
    </Card>
  );
}

export function CashFlowCard({ label, cents, delta, tone, hidden }: { label: string; cents: number; delta?: number; tone: "income" | "expense"; hidden?: boolean }) {
  const theme = useFinanceTheme();
  return (
    <View style={[styles.flowCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <Box row style={{ alignItems: "center", gap: spacing.xs }}>
        <View style={[styles.flowDot, { backgroundColor: theme[tone] }]} />
        <Text variant="body4" color="muted">{label}</Text>
      </Box>
      <Money cents={hidden ? 0 : cents} variant="numericLarge" color={tone} />
      {delta !== undefined ? <Badge label={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`} tone={delta >= 0 ? "income" : "expense"} /> : null}
    </View>
  );
}

/** Pockaw transaction tile: 54px category icon block, type-tinted. */
export function TransactionTile({ transaction, onPress, hidden }: { transaction: FinanceTransaction; onPress?: () => void; hidden?: boolean }) {
  const theme = useFinanceTheme();
  const tone = transaction.kind === "income" ? theme.income : transaction.kind === "transfer" ? theme.transfer : theme.expense;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }: { pressed: boolean }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <CategoryIcon icon={transaction.icon ?? "cash"} color={tone} />
      <View style={styles.tileBody}>
        <Text variant="body2" numberOfLines={1}>{transaction.title}</Text>
        <Text variant="body4" color="muted" numberOfLines={1}>{`${transaction.category} · ${transaction.date}`}</Text>
      </View>
      <Money cents={hidden ? 0 : transaction.amountCents} variant="numericMedium" color={transaction.kind === "income" ? "income" : undefined} />
    </Pressable>
  );
}

export function CategoryIcon({ icon = "shape-outline", color }: { icon?: IconName; color?: string }) {
  const theme = useFinanceTheme();
  return <View style={[styles.categoryIcon, { backgroundColor: (color ?? theme.primary) + "22" }]}><Icon name={icon} size={22} color={color ?? theme.primary} /></View>;
}

/** Dompetku-style wallet switcher pills. */
export function WalletSwitcher({ wallets, active, onChange }: { wallets: { id: string; name: string; currency: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <Box row gap={spacing.mdSm}>
      {wallets.map((wallet) => <Badge key={wallet.id} label={`${wallet.name} · ${wallet.currency}`} tone={active === wallet.id ? "primary" : "muted"} />)}
    </Box>
  );
}

/** Boring Balance stat card with tabular figures. */
export function StatCard({ label, cents, caption, tone }: { label: string; cents: number; caption?: string; tone?: "income" | "expense" }) {
  return (
    <Card style={styles.statCard}>
      <Text variant="body4" color="muted">{label}</Text>
      <Money cents={cents} variant="numericMedium" color={tone} />
      {caption ? <Text variant="body5" color="muted">{caption}</Text> : null}
    </Card>
  );
}

/** Pockaw spending-by-category donut with external legend. */
export function CategoryDonut({ data, total }: { data: { label: string; cents: number; color?: string }[]; total: number }) {
  const theme = useFinanceTheme();
  const size = 180;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Card>
      <View style={styles.donutWrap}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.surfaceAlt} strokeWidth={stroke} fill="none" />
          {data.map((slice, index) => {
            const length = total > 0 ? (slice.cents / total) * circumference : 0;
            const dash = `${Math.max(0, length - 2)} ${circumference}`;
            const node = <Circle key={slice.label} cx={size / 2} cy={size / 2} r={r} stroke={slice.color ?? palette.chart[index % palette.chart.length]} strokeWidth={stroke} fill="none" strokeDasharray={dash} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
            offset += length;
            return node;
          })}
        </Svg>
        <View style={styles.donutCenter}><Money cents={total} variant="numericLarge" /></View>
      </View>
      <View style={styles.legend}>
        {data.map((slice, index) => (
          <Box key={slice.label} row gap={spacing.xs}>
            <View style={[styles.legendDot, { backgroundColor: slice.color ?? palette.chart[index % palette.chart.length] }]} />
            <Text variant="body4">{slice.label}</Text>
            <Text variant="body4" color="muted">{` ${Math.round(total ? (slice.cents / total) * 100 : 0)}%`}</Text>
          </Box>
        ))}
      </View>
    </Card>
  );
}

/** Jings-style day scroller strip with activity dots. */
export function DayScroller({ days, active, onChange }: { days: { key: string; label: string; active?: boolean }[]; active: string; onChange: (key: string) => void }) {
  const theme = useFinanceTheme();
  return (
    <Box row gap={spacing.mdSm}>
      {days.map((day) => (
        <Pressable key={day.key} onPress={() => onChange(day.key)} accessibilityRole="button" style={[styles.day, active === day.key && { backgroundColor: theme.primary }]}>
          <RNText style={[typography.body4, { fontFamily: typography.font.display, color: active === day.key ? theme.surface : theme.muted }]}>{day.label}</RNText>
          {day.active ? <View style={[styles.dayDot, { backgroundColor: active === day.key ? theme.surface : theme.primary }]} /> : null}
        </Pressable>
      ))}
    </Box>
  );
}

/** Minimal spark line for cash-flow trends. */
export function Sparkline({ points, color }: { points: number[]; color?: string }) {
  const theme = useFinanceTheme();
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${index * 14},${40 - ((point - min) / span) * 34}`).join(" ");
  return <Svg width={points.length * 14} height={44}><Path d={path} stroke={color ?? theme.primary} strokeWidth={2.5} fill="none" /></Svg>;
}

const styles = StyleSheet.create({
  balanceCard: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  flowCard: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  flowDot: { width: 8, height: 8, borderRadius: 4 },
  tile: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md },
  tileBody: { flex: 1, gap: 2 },
  categoryIcon: { width: 54, height: 54, borderRadius: radius.card, alignItems: "center", justifyContent: "center" },
  statCard: { flex: 1, gap: spacing.xs },
  donutWrap: { alignItems: "center", justifyContent: "center", minHeight: 190 },
  donutCenter: { position: "absolute", alignItems: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.mdSm },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  day: { minWidth: 42, minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: spacing.mdSm },
  dayDot: { width: 5, height: 5, borderRadius: 3 },
});
