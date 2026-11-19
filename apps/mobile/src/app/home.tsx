import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Box, Card, Chip, FadeIn, FgAccountRow, FgBudgetRing, FgHeaderIcon,
  FgLink, FgScreen, FgSection, FgStatCard, Tile,
} from "@finance/ui";
import { core } from "../rust/core";
import { allTransactions, accounts } from "../db/moneyTracker";
import { gold } from "../db/upstreamFeatures";

/** Values shown in the Finanzguru Play Store Overview screenshot. */
const SHOWCASE = {
  availableCents: 82300,
  accounts: [
    { emoji: "🏦", name: "Checking account", cents: 320599 },
    { emoji: "💳", name: "Credit card", cents: -25636 },
    { emoji: "🅿️", name: "PayPal", cents: 3730 },
  ],
  portfolioCents: 1218722,
};

export default function HomeScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [accountRows, setAccountRows] = useState<{ id: string; balanceCents: number; kind: string }[]>([]);
  const [portfolioCents, setPortfolioCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([allTransactions(), accounts(), gold()])
      .then(([t, a, holdings]) => {
        setRows(t); setAccountRows(a as never);
        const investments = a.filter((row) => row.kind === "investment").reduce((sum, row) => sum + row.balanceCents, 0);
        const metal = holdings.reduce((sum, row) => sum + Math.round(row.grams * row.currentCentsPerGram), 0);
        setPortfolioCents(investments + metal);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your dashboard"))
      .finally(() => setLoading(false));
  }, []);

  const month = core.monthKey(new Date());
  const totals = core.txTotals(rows, month);
  const hasData = rows.length > 0;
  const availableCents = hasData ? Math.max(0, totals.income - totals.expense) : SHOWCASE.availableCents;
  const accountLines = SHOWCASE.accounts.map((row, i) => {
    const real = accountRows[i]?.balanceCents;
    return real ? { ...row, cents: real } : row;
  });

  return (
    <FgScreen
      title="Overview"
      actions={
        <>
          <FgHeaderIcon name="format-list-bulleted" label="All apps" onPress={() => router.push("/hub")} />
          <FgHeaderIcon name="account-circle" label="Profile" onPress={() => router.push("/settings")} />
        </>
      }
    >
      <AsyncBoundary loading={loading} error={error} onRetry={() => router.replace("/home")} rows={5}>
        <FadeIn>
          <FgStatCard availableCents={availableCents} onPress={() => router.push("/reports")} />
        </FadeIn>
        <FadeIn delay={60}>
          <FgSection title="Budgets" action={<FgLink label="Show all" onPress={() => router.push("/budgets")} />}>
            <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <FgBudgetRing emoji="🍽️" progress={0.62} color="#E4647A" onPress={() => router.push("/budgets")} />
              <FgBudgetRing emoji="🛒" progress={0.48} color="#F2A93B" onPress={() => router.push("/budgets")} />
              <FgBudgetRing emoji="🏖️" progress={0.75} color="#2FBFA0" onPress={() => router.push("/budgets")} />
              <FgBudgetRing emoji="🚗" progress={0.35} color="#3C318F" onPress={() => router.push("/budgets")} />
              <FgHeaderIcon name="plus" label="Add budget" onPress={() => router.push("/budgets")} />
            </Card>
          </FgSection>
        </FadeIn>
        <FadeIn delay={120}>
          <FgSection title="Accounts" action={<FgLink label="Show all" onPress={() => router.push("/accounts")} />}>
            <Card>
              {accountLines.map((row) => (
                <FgAccountRow key={row.name} emoji={row.emoji} name={row.name} cents={row.cents} onPress={() => router.push("/accounts")} />
              ))}
            </Card>
          </FgSection>
        </FadeIn>
        <FadeIn delay={180}>
          <FgSection title="Investments" action={<FgLink label="Show all" onPress={() => router.push("/holdings")} />}>
            <Card>
              <FgAccountRow emoji="📈" name="Portfolio" cents={portfolioCents || SHOWCASE.portfolioCents} onPress={() => router.push("/holdings")} />
            </Card>
          </FgSection>
        </FadeIn>
      </AsyncBoundary>
      <FadeIn delay={220}>
        <Card>
          <Chip label="Recipes" onPress={() => router.push("/recipes")} selected />
          <Box row gap={8} style={{ flexWrap: "wrap", marginTop: 10 }}>
            <Tile icon="tag-search" label="Compare prices" onPress={() => router.push("/prices")} accent />
            <Tile icon="cart" label="Shopping list" onPress={() => router.push("/list")} />
            <Tile icon="receipt" label="Transactions" onPress={() => router.push("/transactions")} />
            <Tile icon="chart-bar" label="Reports" onPress={() => router.push("/reports")} />
            <Tile icon="store" label="Shops & offers" onPress={() => router.push("/shops")} />
            <Tile icon="target" label="Goals" onPress={() => router.push("/goals")} />
            <Tile icon="view-grid" label="All apps" onPress={() => router.push("/hub")} />
          </Box>
        </Card>
      </FadeIn>
    </FgScreen>
  );
}
