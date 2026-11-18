import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Box, BudgetCard, Button, Card, Segmented, Text, TextField } from "@finance/ui";
import { Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { allTransactions, budgets, setBudget } from "../db/moneyTracker";

export default function BudgetsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<{ id: number; category: string; limitCents: number; rolloverCents: number }[]>([]);
  const [tx, setTx] = useState<Record<string, unknown>[]>([]);
  const [scope, setScope] = useState<"weekly" | "monthly">("monthly");
  const [category, setCategory] = useState("Groceries");
  const [limit, setLimit] = useState("250");
  const [rolloverText, setRolloverText] = useState("20");

  const load = async () => { const [b, t] = await Promise.all([budgets(), allTransactions()]); setRows(b as never); setTx(t); };
  useEffect(() => { void load(); }, []);

  const month = core.monthKey(new Date());
  const spending = scope === "monthly" ? core.categoryTotals(tx, month) : core.categoryTotals(tx.filter((r) => core.periodKey("week", new Date(String(r.date))) === core.periodKey("week", new Date())), "");
  const status = core.rolloverStatus(rows, spending);

  return (
    <Screen title="Budgets" subtitle="Pockaw periods + Dompetku rollover + Boring analysis" back={<Button label="Back" variant="secondary" onPress={() => router.back()} />}>
      <Card>
        <Segmented value={scope} onChange={setScope} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
        <Text variant="body5" color="muted">Alerts trigger at 80% and 100% of the available amount.</Text>
      </Card>
      {status.map((s) => <BudgetCard key={s.category} category={s.category} spentCents={s.spent} limitCents={s.limit} rolloverCents={s.rollover} />)}
      <Card>
        <SectionTitle>New budget</SectionTitle>
        <TextField label="Category" value={category} onChangeText={setCategory} />
        <Box row gap={8}>
          <TextField label="Limit" value={limit} onChangeText={setLimit} numeric />
          <TextField label="Rollover" value={rolloverText} onChangeText={setRolloverText} numeric />
        </Box>
        <Button label="Save budget" icon="plus" onPress={() => { const l = parseEuro(limit); const r = parseEuro(rolloverText); if (l !== null && r !== null && category) void setBudget(category, l, r, true).then(load); }} />
      </Card>
    </Screen>
  );
}
