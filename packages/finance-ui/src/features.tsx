import React from "react";
import { StyleSheet, View } from "react-native";
import { Badge, Box, Button, Card, Checkbox, Icon, Money, Progress, Text, type IconName, useFinanceTheme } from "./primitives";
import { radius, spacing } from "./tokens";

/** Jings Finance: paycheck waterfall steps with allocation amounts. */
export function PaycheckWaterfall({ takeHomeCents, steps }: {
  takeHomeCents: number; steps: { label: string; cents: number; kind: "fixed" | "envelope" | "plan" | "invest" | "leftover" }[];
}) {
  const theme = useFinanceTheme();
  let running = takeHomeCents;
  return (
    <Card>
      <Text variant="heading6">Paycheck waterfall</Text>
      <Text variant="body4" color="muted">Give every unit a job before spending it.</Text>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="body3">Take-home</Text><Money cents={takeHomeCents} variant="numericLarge" /></Box>
      {steps.map((step, index) => {
        const before = running;
        running -= step.cents;
        const color = step.kind === "fixed" ? theme.ios.fixed : step.kind === "envelope" ? theme.ios.variable : step.kind === "plan" ? theme.ios.goal : step.kind === "invest" ? theme.ios.investment : theme.primary;
        return (
          <View key={`${step.label}-${index}`} style={styles.waterfallRow}>
            <View style={[styles.stepDot, { backgroundColor: color }]} />
            <Text variant="body3" style={styles.grow}>{step.label}</Text>
            <Money cents={step.cents} variant="numericMedium" color={step.cents > before ? "expense" : undefined} />
            <Text variant="body5" color="muted">{`left ${Math.round(running / 100)}`}</Text>
          </View>
        );
      })}
      <Progress value={takeHomeCents ? ((takeHomeCents - running) / takeHomeCents) * 100 : 0} />
    </Card>
  );
}

/** Dompetku Kantong / envelope budgeting. */
export function EnvelopeList({ envelopes }: { envelopes: { id: string; name: string; balanceCents: number; limitCents: number; rollover?: boolean }[] }) {
  return (
    <Card>
      <Text variant="heading6">Envelopes</Text>
      {envelopes.map((envelope) => (
        <View key={envelope.id} style={styles.gap}>
          <Box row style={{ justifyContent: "space-between" }}>
            <Text variant="body3">{envelope.name}</Text>
            <Money cents={envelope.balanceCents} variant="numericMedium" />
          </Box>
          <Progress value={envelope.limitCents ? (envelope.balanceCents / envelope.limitCents) * 100 : 0} color={envelope.balanceCents < envelope.limitCents * 0.2 ? "#E50855" : undefined} />
          <Text variant="body5" color="muted">{envelope.rollover ? "rolls over" : "resets each period"}</Text>
        </View>
      ))}
    </Card>
  );
}

/** Pockaw goal card with checklist sub-items. */
export function GoalCard({ goal, onToggleItem, onContribute }: {
  goal: { id: string; title: string; targetCents: number; savedCents: number; pinned?: boolean; items: { id: string; title: string; amountCents: number; completed: boolean }[] };
  onToggleItem?: (id: string) => void; onContribute?: (cents: number) => void;
}) {
  const theme = useFinanceTheme();
  const percent = goal.targetCents ? Math.min(100, (goal.savedCents / goal.targetCents) * 100) : 0;
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}>
        <Text variant="heading6">{goal.title}</Text>
        {goal.pinned ? <Icon name="pin" size={16} color={theme.primary} /> : null}
      </Box>
      <Money cents={goal.savedCents} variant="numericTitle" color="primary" />
      <Text variant="body4" color="muted">{`of ${(goal.targetCents / 100).toFixed(2)} · ${Math.round(percent)}%`}</Text>
      <Progress value={percent} />
      {goal.items.map((item) => (
        <Checkbox key={item.id} checked={item.completed} onPress={() => onToggleItem?.(item.id)} label={`${item.title} · ${(item.amountCents / 100).toFixed(2)}`} />
      ))}
      {onContribute ? <Button label="Contribute" onPress={() => onContribute(1000)} /> : null}
    </Card>
  );
}

/** Dompetku budget with rollover and alert state. */
export function BudgetCard({ category, spentCents, limitCents, rolloverCents = 0 }: { category: string; spentCents: number; limitCents: number; rolloverCents?: number }) {
  const theme = useFinanceTheme();
  const percent = limitCents ? (spentCents / limitCents) * 100 : 0;
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}>
        <Text variant="body2">{category}</Text>
        {percent >= 100 ? <Badge label="OVER" tone="expense" /> : percent >= 80 ? <Badge label="NEAR LIMIT" tone="primary" /> : null}
      </Box>
      <Progress value={percent} color={percent >= 100 ? theme.expense : percent >= 80 ? "#FF9500" : theme.primary} />
      <Text variant="body4" color="muted">{`${(spentCents / 100).toFixed(2)} / ${(limitCents / 100).toFixed(2)} · rollover ${(rolloverCents / 100).toFixed(2)}`}</Text>
    </Card>
  );
}

/** Boring Balance recurring event row. */
export function RecurringRow({ name, nextDate, cents, paused }: { name: string; nextDate: string; cents: number; paused?: boolean }) {
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 48 }}>
      <Box gap={2}><Text variant="body3">{name}</Text><Text variant="body5" color="muted">{nextDate}</Text></Box>
      <Box gap={2}><Money cents={cents} variant="numericMedium" />{paused ? <Badge label="PAUSED" tone="muted" /> : null}</Box>
    </Box>
  );
}

/** Dompetku debt / subscription row. */
export function ObligationRow({ name, remainingCents, dueDate, kind }: { name: string; remainingCents: number; dueDate: string; kind: "debt" | "subscription" }) {
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 48 }}>
      <Box gap={2}><Text variant="body3">{name}</Text><Text variant="body5" color="muted">{`${kind} · ${dueDate}`}</Text></Box>
      <Money cents={remainingCents} variant="numericMedium" color="expense" />
    </Box>
  );
}

/** Boring Balance account valuation snapshot. */
export function ValuationRow({ label, valueCents, changeCents }: { label: string; valueCents: number; changeCents?: number }) {
  const theme = useFinanceTheme();
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 48 }}>
      <Text variant="body3">{label}</Text>
      <Box gap={2}>
        <Money cents={valueCents} variant="numericMedium" />
        {changeCents !== undefined ? <Text variant="body5" color={changeCents >= 0 ? "income" : "expense"}>{`${changeCents >= 0 ? "+" : ""}${(changeCents / 100).toFixed(2)}`}</Text> : null}
      </Box>
      <View style={[styles.dot, { backgroundColor: theme.primary }]} />
    </Box>
  );
}

/** Dompetku split receipt editor. */
export function SplitEditor({ totalCents, people, shares, onChangeShare }: {
  totalCents: number; people: string[]; shares: number[]; onChangeShare: (index: number, share: number) => void;
}) {
  return (
    <Card>
      <Text variant="heading6">Split receipt</Text>
      <Money cents={totalCents} variant="numericTitle" />
      {people.map((person, index) => (
        <Box key={person} row style={{ justifyContent: "space-between" }}>
          <Text variant="body3">{person}</Text>
          <Text variant="body4" color="muted">{`${shares[index] ?? 0}%`}</Text>
          <Money cents={Math.round(totalCents * (shares[index] ?? 0) / 100)} variant="numericMedium" />
        </Box>
      ))}
    </Card>
  );
}

/** Dompetku invoice summary card. */
export function InvoiceCard({ number, customer, totalCents, status }: { number: string; customer: string; totalCents: number; status: "draft" | "sent" | "paid" }) {
  const tone = status === "paid" ? "income" : status === "sent" ? "primary" : "muted";
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="body3">{number}</Text><Badge label={status.toUpperCase()} tone={tone} /></Box>
      <Text variant="body4" color="muted">{customer}</Text>
      <Money cents={totalCents} variant="numericLarge" />
    </Card>
  );
}

/** Boring Balance Compare / breakdown row. */
export function CompareRow({ label, currentCents, previousCents }: { label: string; currentCents: number; previousCents: number }) {
  const change = previousCents ? ((currentCents - previousCents) / previousCents) * 100 : 0;
  return (
    <Box row style={{ justifyContent: "space-between", minHeight: 44 }}>
      <Text variant="body3">{label}</Text>
      <Box gap={2}>
        <Money cents={currentCents} variant="numericMedium" />
        <Text variant="body5" color={change >= 0 ? "income" : "expense"}>{`${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs last month`}</Text>
      </Box>
    </Box>
  );
}

/** Jings savings plan card with progress ring value. */
export function PlanCard({ title, targetCents, savedCents, pace, paused }: { title: string; targetCents: number; savedCents: number; pace?: string; paused?: boolean }) {
  const percent = targetCents ? Math.min(100, (savedCents / targetCents) * 100) : 0;
  return (
    <Card>
      <Box row style={{ justifyContent: "space-between" }}><Text variant="heading6">{title}</Text>{paused ? <Badge label="PAUSED" tone="muted" /> : <Text variant="body4" color="primary">{`${Math.round(percent)}%`}</Text>}</Box>
      <Progress value={percent} />
      <Text variant="body4" color="muted">{`${(savedCents / 100).toFixed(2)} of ${(targetCents / 100).toFixed(2)}`}</Text>
      {pace ? <Text variant="body5" color="muted">{pace}</Text> : null}
    </Card>
  );
}

export function FeatureIcon({ name }: { name: IconName }) { const theme = useFinanceTheme(); return <Icon name={name} size={18} color={theme.primary} />; }

const styles = StyleSheet.create({
  waterfallRow: { flexDirection: "row", alignItems: "center", gap: spacing.mdSm, minHeight: 40 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  grow: { flex: 1 },
  gap: { gap: spacing.xs, marginTop: spacing.mdSm },
  dot: { width: 8, height: 8, borderRadius: radius.full },
});
