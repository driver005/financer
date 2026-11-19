import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, BalanceCard, Box, Card, CategoryAssetIcon, CategoryDonut, DayScroller,
  FadeIn, Money, Sparkline, Text, Tile,
} from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { allTransactions, accounts, budgets } from "../db/moneyTracker";
import { shoppingList } from "../db/shopping";
import { offers as localOffers } from "../db/money";

export default function HomeScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [accountRows, setAccountRows] = useState<{ id: string; balanceCents: number }[]>([]);
  const [budgetRows, setBudgetRows] = useState<unknown[]>([]);
  const [openItems, setOpenItems] = useState(0);
  const [offerRows, setOfferRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState("2");

  useEffect(() => {
    void Promise.all([allTransactions(), accounts(), budgets(), shoppingList("week", core.periodKey("week", new Date())), localOffers()])
      .then(([t, a, b, items, offers]) => {
        setRows(t); setAccountRows(a as never); setBudgetRows(b);
        setOpenItems(items.filter((i) => !i.checked).length);
        setOfferRows(offers); setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your dashboard"))
      .finally(() => setLoading(false));
  }, []);

  const month = core.monthKey(new Date());
  const totals = core.txTotals(rows, month);
  const categories = core.categoryTotals(rows, month);
  const netWorth = accountRows.reduce((sum, a) => sum + a.balanceCents, 0);

  return (
    <Screen title="Home" subtitle="Your money and kitchen, together" action={<AppIconButton icon="view-grid" label="All apps" onPress={() => router.push("/hub")} />}>
      <AsyncBoundary loading={loading} error={error} onRetry={() => router.replace("/home")} rows={4}>
        <FadeIn>
          <BalanceCard
            balanceCents={totals.balance}
            incomeCents={totals.income}
            expenseCents={totals.expense}
            incomeDelta={4.2}
            expenseDelta={-2.1}
            wallet="Main wallet"
          />
        </FadeIn>
        <FadeIn delay={60}>
          <Box row gap={12}>
            <Card style={{ flex: 1 }}><Text variant="body5" color="muted">Net worth</Text><Money cents={netWorth} variant="numericTitle" /></Card>
            <Card style={{ flex: 1 }}><Text variant="body5" color="muted">List open</Text><Money cents={openItems * 100} variant="numericTitle" color="primary" /></Card>
          </Box>
        </FadeIn>
        <FadeIn delay={120}>
          <Card>
            <SectionTitle>This week</SectionTitle>
            <DayScroller days={["M", "T", "W", "T", "F", "S", "S"].map((label, i) => ({ key: String(i), label, active: i === 2 }))} active={day} onChange={setDay} />
            <Sparkline points={[12, 18, 9, 22, 17, 25, 20]} />
            <Text variant="body5" color="muted">{`${budgetRows.length} budgets · ${offerRows.length} Angebote`}</Text>
          </Card>
        </FadeIn>
        <FadeIn delay={180}>
          <CategoryDonut data={categories.slice(0, 6).map((c) => ({ label: c.category, cents: c.cents }))} total={totals.expense} />
        </FadeIn>
      </AsyncBoundary>
      <FadeIn delay={240}>
        <Card>
          <SectionTitle>Jump in</SectionTitle>
          <Box row gap={12} style={{ flexWrap: "wrap" }}>
            <Tile icon="food" label="Recipes" onPress={() => router.push("/recipes")} accent />
            <Tile icon="cart" label="Shopping list" onPress={() => router.push("/list")} />
            <Tile icon="receipt" label="Transactions" onPress={() => router.push("/transactions")} />
            <Tile icon="chart-bar" label="Reports" onPress={() => router.push("/reports")} />
            <Tile icon="store" label="Shops & offers" onPress={() => router.push("/shops")} />
            <Tile icon="target" label="Goals" onPress={() => router.push("/goals")} />
          </Box>
          <Box row gap={8} style={{ marginTop: 12 }}>
            <CategoryAssetIcon category="Groceries" size={34} />
            <CategoryAssetIcon category="Transport" size={34} />
            <CategoryAssetIcon category="Leisure" size={34} />
            <Text variant="body5" color="muted">Category artwork from Pockaw</Text>
          </Box>
        </Card>
      </FadeIn>
    </Screen>
  );
}
