import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Box, Button, Card, FadeIn, FgHeaderIcon, FgScreen, FgSection, Icon, Progress, Text } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { loadSavings, reservePoints } from "../lib/finanzguru";

type Savings = Awaited<ReturnType<typeof loadSavings>>;

export default function SavingsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Savings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void loadSavings()
      .then((d) => { setData(d); setError(null); })
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
      actions={<FgHeaderIcon name="information-outline" label="About" onPress={() => router.push("/upstream")} />}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {data && <>
          <FadeIn>
            <Card>
              <Box row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Box>
                  <Text variant="caption" color="muted">Your Sparbooster points</Text>
                  <Text variant="numericHeading">{data.points.toLocaleString("de-DE")}</Text>
                  <Text variant="body4" color="muted">{`from ${data.cashbackCount} local cashback transactions and ${fgEuro(data.savedCents)} saved`}</Text>
                </Box>
                <Icon name="piggy-bank" size={40} color="#7B3FE4" />
              </Box>
            </Card>
          </FadeIn>
          <FadeIn delay={60}>
            <FgSection title="Reserve for retirement depot">
              <Card>
                <Text variant="body3" color="muted">Reserve your points for the state-backed Altersvorsorgedepot and receive a 7 % annual bonus until it launches in 2027.</Text>
                <Box row style={{ justifyContent: "space-between" }}>
                  <Text variant="body3">Bonus</Text>
                  <Text variant="numericTitle">+{data.bonusPoints.toLocaleString("de-DE")} pts / year</Text>
                </Box>
                {data.reserved ? (
                  <Text variant="body3" color="income">{`Reserved · ${data.reservedPoints.toLocaleString("de-DE")} points locked in locally`}</Text>
                ) : (
                  <Button label="Reserve points" icon="lock" onPress={() => void reserve()} />
                )}
                <Text variant="body5" color="muted">Local simulation — no financial product is opened.</Text>
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={120}>
            <FgSection title="Emergency fund & goals" action={<Text variant="body4" color="muted">local</Text>}>
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
          <FadeIn delay={180}>
            <FgSection title="Cashback offers">
              <Card>
                {data.offers.length ? data.offers.map((offer) => (
                  <Box key={offer.id} row style={{ justifyContent: "space-between", paddingVertical: 8 }}>
                    <Box>
                      <Text variant="body3">{offer.product}</Text>
                      <Text variant="caption" color="muted">{offer.storeName}</Text>
                    </Box>
                    <Text variant="body3" color="income">{offer.price}</Text>
                  </Box>
                )) : <Text variant="body3" color="muted">No local offers yet. Add offers under Shops & offers to see cashback here.</Text>}
              </Card>
            </FgSection>
          </FadeIn>
        </>}
      </AsyncBoundary>
    </FgScreen>
  );
}
