import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Box, Card, FgAccountRow, FgBudgetRing, FgHeaderIcon, FgScreen, FgSection, FgLink, PlayHero, StreakBadge, Tile, XpBar } from "@finance/ui";
import { core } from "../rust/core";
import { allTransactions, accounts } from "../db/moneyTracker";
import { gold } from "../db/upstreamFeatures";

export default function HomeScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [accountRows, setAccountRows] = useState<{ id: string; name: string; balanceCents: number }[]>([]);
  const [portfolioCents, setPortfolioCents] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([allTransactions(), accounts(), gold()])
      .then(([t, a, holdings]) => {
        setRows(t);
        setAccountRows(a as never);
        setPortfolioCents(
          a.filter((r) => r.kind === "investment").reduce((s, r) => s + r.balanceCents, 0) +
          holdings.reduce((s, r) => s + Math.round(r.grams * r.currentCentsPerGram), 0),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const month = core.monthKey(new Date());
  const totals = core.txTotals(rows, month);
  const available = rows.length ? Math.max(0, totals.income - totals.expense) : 82350;
  const balance = accountRows.reduce((sum, a) => sum + a.balanceCents, 0) || 320599;
  const displayAccounts = [
    { emoji: "🏦", name: "Checking account", cents: 320599 },
    { emoji: "💳", name: "Credit card", cents: -25636 },
    { emoji: "🅿️", name: "PayPal", cents: 3730 },
  ].map((row, i) => (accountRows[i]?.balanceCents ? { ...row, cents: accountRows[i].balanceCents } : row));

  return (
    <FgScreen
      title="Hey Alex 👋"
      actions={<>
        <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
        <FgHeaderIcon name="cog-outline" label="Settings" onPress={() => router.push("/settings")} />
      </>}
    >
      <PlayHero
        emoji="💰"
        title="Your balance"
        value={`${(balance / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`}
        caption={loading ? "Loading your money…" : `Nice! ${(available / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} € available to spend`}
        progress={0.68}
        cta="Compare prices"
        onPress={() => router.push("/prices")}
      />
      <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <StreakBadge days={7} />
        <XpBar current={420} total={600} />
      </Box>
      <FgSection title="Budgets" action={<FgLink label="Show all" onPress={() => router.push("/budgets")} />}>
        <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <FgBudgetRing emoji="🏠" progress={0.62} color="#FF9600" onPress={() => router.push("/budgets")} />
          <FgBudgetRing emoji="🥤" progress={0.48} color="#1CB0F6" onPress={() => router.push("/budgets")} />
          <FgBudgetRing emoji="😊" progress={0.75} color="#58CC02" onPress={() => router.push("/budgets")} />
          <FgBudgetRing emoji="🛍️" progress={0.35} color="#CE82FF" onPress={() => router.push("/budgets")} />
          <FgHeaderIcon name="plus" label="Add budget" onPress={() => router.push("/budgets")} />
        </Card>
      </FgSection>
      <FgSection title="Your accounts" action={<FgLink label="Show all" onPress={() => router.push("/accounts")} />}>
        <Card>
          {displayAccounts.map((row) => (
            <FgAccountRow key={row.name} emoji={row.emoji} name={row.name} cents={row.cents} onPress={() => router.push("/accounts")} />
          ))}
        </Card>
      </FgSection>
      <FgSection title="Investments" action={<FgLink label="Show all" onPress={() => router.push("/holdings")} />}>
        <Card>
          <FgAccountRow emoji="📈" name="Portfolio" cents={portfolioCents || 1218722} onPress={() => router.push("/holdings")} />
        </Card>
      </FgSection>
      <Card>
        <Box row gap={8} style={{ flexWrap: "wrap" }}>
          <Tile icon="food" label="Recipes" onPress={() => router.push("/recipes")} accent />
          <Tile icon="cart" label="Shopping list" onPress={() => router.push("/list")} />
          <Tile icon="receipt" label="Transactions" onPress={() => router.push("/transactions")} />
          <Tile icon="store" label="Shops & offers" onPress={() => router.push("/shops")} />
          <Tile icon="shield-outline" label="Insurance" onPress={() => router.push("/insurance")} />
          <Tile icon="piggy-bank" label="Savings Booster" onPress={() => router.push("/savings")} />
        </Box>
      </Card>
    </FgScreen>
  );
}
