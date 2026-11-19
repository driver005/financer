import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Box, Button, Card, FadeIn, FgBudgetBar, FgBudgetCard, FgHeaderIcon, FgScreen, FgSection, Sheet, Text, TextField } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { allTransactions, budgets, setBudget } from "../db/moneyTracker";

const EMOJI: Record<string, string> = {
  Living: "🏠", Rent: "🏠", "Food & Drinks": "🥤", Groceries: "🛒", Leisure: "😊",
  "Lifestyle & Sports": "😊", Shopping: "🛍️", Transport: "🚗", "Internet & Phone": "📱",
  Streaming: "🎬", Health: "🏥", Salary: "💼",
};
const COLORS = ["#3C318F", "#2F80ED", "#2FBFA0", "#F2A93B", "#E4647A"];
const iconFor = (category: string) => EMOJI[category] ?? "🏷️";

type Status = { category: string; spent: number; limit: number; remaining: number; percent: number };

export default function BudgetsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<{ id: number; category: string; limitCents: number; rolloverCents: number }[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [spending, setSpending] = useState<{ category: string; cents: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Groceries");
  const [limit, setLimit] = useState("250");

  const load = () => {
    setLoading(true);
    void Promise.all([budgets(), allTransactions()])
      .then(([b, tx]) => {
        const month = core.monthKey(new Date());
        const totals = core.categoryTotals(tx, month) as { category: string; cents: number }[];
        setRows(b as never);
        setSpending([...totals].sort((a, z) => z.cents - a.cents).slice(0, 5));
        setStatus(core.budgetStatus(b, totals) as Status[]);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load budgets"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = () => {
    const cents = parseEuro(limit);
    if (cents === null || !category) return;
    void setBudget(category, cents, 0, true).then(() => { setOpen(false); load(); });
  };

  const max = Math.max(1, ...spending.map((s) => Math.abs(s.cents)));

  return (
    <FgScreen title="Budgets" actions={<>
      <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
      <FgHeaderIcon name="plus" label="Add budget" onPress={() => setOpen(true)} />
    </>}>
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        <FadeIn>
          <Card>
            <Text variant="heading5">Monatliche Ausgaben</Text>
            {spending.length ? spending.map((item, i) => (
              <FgBudgetBar key={item.category} emoji={iconFor(item.category)} label={item.category}
                cents={Math.abs(item.cents)} maxCents={max} color={COLORS[i % COLORS.length]} />
            )) : <Text variant="body3" color="muted">No expenses recorded this month.</Text>}
          </Card>
        </FadeIn>
        <FadeIn delay={80}>
          <FgSection title="Your budgets">
            {status.length ? status.map((item) => (
              <FgBudgetCard key={item.category} emoji={iconFor(item.category)} label={item.category}
                leftCents={item.remaining - (rows.find((r) => r.category === item.category)?.rolloverCents ?? 0)}
                progress={item.percent} onPress={() => router.push("/insights")} />
            )) : <Card><Text variant="body3" color="muted">No budgets yet. Tap + to create one.</Text></Card>}
          </FgSection>
        </FadeIn>
        <FadeIn delay={140}>
          <Card>
            <Text variant="body4" color="muted">{`${rows.length} budgets · ${spending.length} categories tracked locally`}</Text>
          </Card>
        </FadeIn>
      </AsyncBoundary>

      <Sheet visible={open} onClose={() => setOpen(false)} title="New budget">
        <Text variant="body4" color="muted">Monthly limit, stored locally and used by Insights.</Text>
        <TextField label="Category" value={category} onChangeText={setCategory} />
        <TextField label="Monthly limit" value={limit} onChangeText={setLimit} numeric placeholder="e.g. 250" />
        <Button label="Save budget" icon="plus" onPress={save} />
      </Sheet>
    </FgScreen>
  );
}
