import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Box, Button, Card, FadeIn, FgHeaderIcon, FgPointsCard, FgScreen, FgSection, FgVoucherRow, Icon, Progress, Text } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { loadSavings, reservePoints } from "../lib/finanzguru";
import { allTransactions } from "../db/moneyTracker";

type Savings = Awaited<ReturnType<typeof loadSavings>>;

export default function SavingsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Savings | null>(null);
  const [potentialCents, setPotentialCents] = useState(0);
  const [txCount, setTxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void Promise.all([loadSavings(), allTransactions()])
      .then(([d, rows]) => {
        setData(d);
        const since = new Date();
        since.setFullYear(since.getFullYear() - 1);
        const lastYear = rows.filter((r) => new Date(String(r.date)) >= since && r.kind !== "income");
        const spent = lastYear.reduce((sum, r) => sum + Math.abs(Number(r.amountCents ?? 0)), 0);
        setPotentialCents(Math.round(spent * 0.05));
        setTxCount(lastYear.length);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Savings Booster"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const reserve = async () => {
    if (!data) return;
    await reservePoints(data.points);
    load();
  };

  return (
    <FgScreen
      title="Savings Booster"
      actions={<>
        <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
        <FgHeaderIcon name="gift-outline" label="Offers" onPress={() => router.push("/shops")} />
      </>}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={6}>
        {data && <>
          <FadeIn>
            <FgPointsCard
              points={data.points}
              euroCents={Math.round(data.points)}
              progress={data.reserved ? 1 : 0.68}
              onCashOut={() => void reserve()}
            />
          </FadeIn>
          <FadeIn delay={60}>
            <FgSection title="Your vouchers">
              {data.offers.length ? data.offers.map((offer) => (
                <FgVoucherRow key={offer.id} store={offer.storeName} amountCents={Number(offer.price.replace(/[^\d,]/g, "").replace(",", ".")) * 100 || 0}
                  onPress={() => router.push("/shops")} />
              )) : <Card><Text variant="body3" color="muted">No vouchers yet. Add offers under Shops & offers.</Text></Card>}
            </FgSection>
          </FadeIn>
          <FadeIn delay={120}>
            <FgSection title="Save on your expenses">
              <Card>
                <Text variant="heading5">Your savings potential</Text>
                <Text variant="numericHeading" color="income">{fgEuro(potentialCents)}</Text>
                <Text variant="body4" color="muted">{`in the last 12 months · ${txCount} local bookings`}</Text>
                <Text variant="body5" color="muted">5 % of tracked spending — an estimate, not a guarantee.</Text>
              </Card>
              {data.offers.length ? data.offers.slice(0, 3).map((offer) => (
                <Card key={`save-${offer.id}`}>
                  <Box row gap={12}>
                    <Icon name="store-outline" size={22} color="#7B3FE4" />
                    <Box style={{ flex: 1 }}>
                      <Text variant="body2">{offer.storeName}</Text>
                      <Text variant="caption" color="income">{offer.note || "Save on your expenses"}</Text>
                    </Box>
                    <Text variant="body4" color="income">{offer.price}</Text>
                  </Box>
                </Card>
              )) : null}
            </FgSection>
          </FadeIn>
          <FadeIn delay={180}>
            <FgSection title="Reserve for retirement depot">
              <Card>
                <Text variant="body3" color="muted">Reserve points for the Altersvorsorgedepot with a 7 % annual bonus until 2027.</Text>
                {data.reserved
                  ? <Text variant="body3" color="income">{`Reserved · ${data.reservedPoints.toLocaleString("de-DE")} points · +${data.bonusPoints} pts/year`}</Text>
                  : <Button label="Reserve points" icon="lock" onPress={() => void reserve()} />}
                <Text variant="body5" color="muted">Local simulation — no financial product is opened.</Text>
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={220}>
            <FgSection title="Emergency fund & goals">
              <Card>
                {data.goals.length ? data.goals.map((goal) => (
                  <Box key={goal.name} gap={4}>
                    <Box row style={{ justifyContent: "space-between" }}>
                      <Text variant="body3">{goal.name}</Text>
                      <Text variant="body4" color="muted">{`${fgEuro(goal.saved)} / ${fgEuro(goal.target)}`}</Text>
                    </Box>
                    <Progress value={goal.percent} />
                  </Box>
                )) : <Text variant="body3" color="muted">No savings goals yet. Create one under Goals.</Text>}
                <Button label="Manage goals" variant="secondary" onPress={() => router.push("/goals")} />
              </Card>
            </FgSection>
          </FadeIn>
        </>}
      </AsyncBoundary>
    </FgScreen>
  );
}
