import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Badge, Box, Button, Card, EmptyState, FadeIn, Money, ObligationRow, ReceivableRow, RecurringRow, SubscriptionRow, Text, TextField } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { recurringList, debts, addDebt } from "../db/moneyTracker";
import { subscriptions, addSubscription, receivables, addReceivable } from "../db/upstreamFeatures";


export default function ObligationsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this screen"); }
    finally { setLoading(false); }
  };
  const [rec, setRec] = useState<{ id: number; name: string; amountCents: number; dayOfMonth: number; active: number }[]>([]);
  const [debtRows, setDebtRows] = useState<{ id: number; name: string; totalCents: number; paidCents: number; dueDate: string }[]>([]);
  const [subs, setSubs] = useState<{ id: number; name: string; amountCents: number; interval: string; startDate: string }[]>([]);
  const [receiv, setReceiv] = useState<{ id: number; name: string; totalCents: number; paidCents: number; dueDate: string }[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");

  const load = async () => { const [r, d, s, v] = await Promise.all([recurringList(), debts(), subscriptions(), receivables()]); setRec(r as never); setDebtRows(d); setSubs(s as never); setReceiv(v); };
  useEffect(() => { void guard(load); }, []);

  return (
    <Screen title="Obligations" subtitle="Recurring, debts, subscriptions, receivables" back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}>
      <AsyncBoundary loading={loading} error={error} onRetry={() => void guard(load)} rows={4}>
      <FadeIn>
      <Card>
        <SectionTitle>Recurring events</SectionTitle>
        {!rec.length ? <EmptyState title="No recurring events" message="Add one below." icon="calendar-clock" /> : null}
        {core.scheduled(rec).map((r, i) => <RecurringRow key={i} name={r.name} nextDate={r.nextDate} cents={r.amountCents} />)}
      </Card>
      <Card>
        <SectionTitle>Debts & receivables</SectionTitle>
        {debtRows.map((d) => <ObligationRow key={d.id} name={d.name} remainingCents={d.totalCents - d.paidCents} dueDate={d.dueDate} kind="debt" />)}
        {core.receivableStatus(receiv).map((r, i) => <ReceivableRow key={i} name={r.name} remainingCents={r.remaining} dueDate={r.dueDate} overdue={r.overdue} />)}
        <TextField label="Name" value={name} onChangeText={setName} />
        <Box row gap={8}>
          <TextField label="Amount" value={amount} onChangeText={setAmount} numeric />
          <TextField label="Due" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" />
        </Box>
        <Button label="Add debt" variant="secondary" onPress={() => { const c = parseEuro(amount); if (c !== null && name) void addDebt(name, c, due).then(() => { setName(""); setAmount(""); void load(); }); }} />
        <Button label="Add receivable" variant="secondary" onPress={() => { const c = parseEuro(amount); if (c !== null && name) void addReceivable(name, c, due).then(() => { setName(""); setAmount(""); void load(); }); }} />
      </Card>
      <Card>
        <SectionTitle>Subscriptions</SectionTitle>
        {!subs.length ? <EmptyState title="No subscriptions" message="Add one below." icon="calendar" /> : null}
        {core.subscriptionNext(subs).map((s, i) => <SubscriptionRow key={i} name={s.name} amountCents={s.amountCents} interval={s.interval} nextDate={s.nextDate} />)}
        <Button label="Add subscription" icon="plus" onPress={() => { const c = parseEuro(amount); if (c !== null && name) void addSubscription(name, c, "monthly", new Date().toISOString().slice(0, 10), 0).then(() => { setName(""); setAmount(""); void load(); }); }} />
      </Card>
      <Text variant="body5" color="muted">Local due reminders are scheduled from Money tools.</Text>
    </FadeIn>
    </AsyncBoundary>
    </Screen>
  );
}
