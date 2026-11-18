import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Badge, Box, BudgetCard, Button, Card, GoalCard, PlanCard, Progress, Text } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { allTransactions, budgets, goals } from "../db/moneyTracker";
import { checklist, toggleChecklistItem } from "../db/appFeatures";
import { goalFundings, fundGoal } from "../db/upstreamFeatures";

export default function GoalsScreen() {
  const router = useRouter();
  const [goalRows, setGoalRows] = useState<{ id: number; name: string; targetCents: number; savedCents: number; paused: number }[]>([]);
  const [budgetRows, setBudgetRows] = useState<{ id: number; category: string; limitCents: number; rolloverCents: number }[]>([]);
  const [checkRows, setCheckRows] = useState<{ id: number; goalId: number; title: string; amountCents: number; completed: number }[]>([]);
  const [fundRows, setFundRows] = useState<{ id: number; cents: number; date: string }[]>([]);
  const [txRows, setTxRows] = useState<Record<string, unknown>[]>([]);

  const load = async () => {
    const [g, b, c, t] = await Promise.all([goals(), budgets(), checklist(), allTransactions()]);
    setGoalRows(g as never); setBudgetRows(b as never); setCheckRows(c as never); setTxRows(t);
    setFundRows(g.length ? await goalFundings(g[0].id) : []);
  };
  useEffect(() => { void load(); }, []);

  const spending = core.categoryTotals(txRows, core.monthKey(new Date()));
  const rolled = core.rolloverStatus(budgetRows, spending);
  const status = core.checklistStatus(goalRows, checkRows);

  return (
    <Screen title="Plans" subtitle="Goals, budgets and checklists" action={<AppIconButton icon="plus" label="More plans" onPress={() => router.push("/projects")} />}>
      <Card>
        <SectionTitle>Goals & plans</SectionTitle>
        {goalRows.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={{
              id: String(goal.id), title: goal.name, targetCents: goal.targetCents, savedCents: goal.savedCents,
              items: checkRows.filter((i) => i.goalId === goal.id).map((i) => ({ id: String(i.id), title: i.title, amountCents: i.amountCents, completed: !!i.completed })),
            }}
            onToggleItem={(id) => void toggleChecklistItem(Number(id), !checkRows.find((i) => String(i.id) === id)?.completed).then(load)}
            onContribute={(cents) => void fundGoal(goal.id, cents).then(load)}
          />
        ))}
        {status.map((s) => <Text key={s.id} variant="body5" color="muted">{`${s.name}: ${s.done}/${s.total} checklist items`}</Text>)}
        <Button label="Projects & envelopes" icon="view-grid" variant="secondary" onPress={() => router.push("/projects")} />
      </Card>
      <Card>
        <SectionTitle>Budgets</SectionTitle>
        {rolled.map((r) => <BudgetCard key={r.category} category={r.category} spentCents={r.spent} limitCents={r.limit} rolloverCents={r.rollover} />)}
        <Button label="Paycheck waterfall" icon="water" variant="secondary" onPress={() => router.push("/paycheck")} />
      </Card>
      <Card>
        <SectionTitle>Funding ledger</SectionTitle>
        {fundRows.map((f) => <Badge key={f.id} label={`${f.date} · ${(f.cents / 100).toFixed(2)}`} />)}
      </Card>
      <PlanCard title="Emergency fund" targetCents={200000} savedCents={85000} pace="8 paychecks left" />
    </Screen>
  );
}
