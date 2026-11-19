import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { BalanceCard, Box, Button, Card, CategoryDonut, DayScroller, FadeIn, Money, Skeleton, Sparkline, StatCard, Text } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { allTransactions, accounts } from "../db/moneyTracker";
import { shoppingList } from "../db/shopping";
import { offers as localOffers } from "../db/money";
import { budgets } from "../db/moneyTracker";

export default function HomeScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [accountRows, setAccountRows] = useState<{ id: string; balanceCents: number }[]>([]);
  const [budgetRows, setBudgetRows] = useState<unknown[]>([]);
  const [openItems, setOpenItems] = useState(0);
  const [offerRows, setOfferRows] = useState<unknown[]>([]);
  const [day, setDay] = useState("today");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([allTransactions(), accounts(), budgets(), shoppingList("week", core.periodKey("week", new Date())), localOffers()])
      .then(([t, a, b, items, offers]) => {
        setRows(t); setAccountRows(a as never); setBudgetRows(b);
        setOpenItems(items.filter((i) => !i.checked).length);
        setOfferRows(offers);
        setLoading(false);
      });
  }, []);

  const month = core.monthKey(new Date());
  const totals = core.txTotals(rows, month);
  const categories = core.categoryTotals(rows, month);
  const netWorth = accountRows.reduce((sum, a) => sum + a.balanceCents, 0);
  const grocery = categories.find((c) => c.category.toLowerCase().includes("grocer"))?.cents ?? 0;

  return (
    <Screen title="Home" subtitle="Everything in one place" action={<AppIconButton icon="view-grid" label="All apps" onPress={() => router.push("/hub")} />}>
      <FadeIn>
      <BalanceCard
        balanceCents={totals.balance}
        incomeCents={totals.income}
        expenseCents={totals.expense}
        incomeDelta={4.2}
        expenseDelta={-2.1}
        wallet="Main wallet"
      />
      <Box row gap={8}>
        <Box style={{ flex: 1 }}><StatCard label="Net worth" cents={netWorth} /></Box>
        <Box style={{ flex: 1 }}><StatCard label="Groceries" cents={grocery} tone="expense" /></Box>
      </Box>
      <Card>
        <Box row style={{ justifyContent: "space-between" }}>
          <Text variant="body3">Shopping list</Text>
          <Text variant="body3" color="primary">{`${openItems} open items`}</Text>
        </Box>
      </Card>
      <Card>
        <SectionTitle>This week</SectionTitle>
        {loading ? <Skeleton rows={2} /> : <>
          <DayScroller
            days={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ key: String(i), label, active: i === 2 }))}
            active={day}
            onChange={setDay}
          />
          <Sparkline points={[12, 18, 9, 22, 17, 25, 20]} />
        </>}
        <Text variant="body5" color="muted">{`${budgetRows.length} budgets · ${offerRows.length} Angebote`}</Text>
      </Card>
      </FadeIn>
      <FadeIn delay={80}>
      <CategoryDonut data={categories.slice(0, 6).map((c) => ({ label: c.category, cents: c.cents }))} total={totals.expense} />
      <Card>
        <SectionTitle>Jump in</SectionTitle>
        <View style={{ gap: 8 }}>
          <Button label="Transactions" icon="receipt" onPress={() => router.push("/transactions")} />
          <Button label="Budgets & goals" icon="target" variant="secondary" onPress={() => router.push("/goals")} />
          <Button label="Shopping list" icon="cart" variant="secondary" onPress={() => router.push("/list")} />
          <Button label="Reports" icon="chart-bar" variant="secondary" onPress={() => router.push("/reports")} />
        </View>
      </Card>
      </FadeIn>
    </Screen>
  );
}
