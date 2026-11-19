import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Box, Card, FadeIn, FgHeaderIcon, FgScreen, FgSection, Icon, Progress, Text } from "@finance/ui";
import { loadInsights } from "../lib/finanzguru";
import { fgEuro } from "@finance/ui";

type Insights = Awaited<ReturnType<typeof loadInsights>>;

export default function InsightsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void loadInsights()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not analyse your transactions"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const change = data?.comparison.current && data.comparison.previous
    ? Math.round(((data.comparison.current - data.comparison.previous) / Math.abs(data.comparison.previous)) * 100)
    : 0;

  return (
    <FgScreen
      title="Insights"
      actions={<>
        <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
        <FgHeaderIcon name="cog-outline" label="Settings" onPress={() => router.push("/settings")} />
      </>}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {data && <>
          <FadeIn>
            <FgSection title="Disposable income">
              <Card>
                <Text variant="caption" color="muted">{`Available this month · ${data.month}`}</Text>
                <Text variant="numericHeading">{fgEuro(Math.max(0, data.totals.income - data.totals.expense))}</Text>
                <Text variant="body3" color="muted">{`${fgEuro(data.totals.income)} in · ${fgEuro(data.totals.expense)} out`}</Text>
                <Text variant="body4" color="muted">{`Based on ${data.count} local transactions`}</Text>
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={60}>
            <FgSection title="Spending trend">
              <Card>
                <Box row style={{ justifyContent: "space-between" }}>
                  <Box>
                    <Text variant="caption" color="muted">This month</Text>
                    <Text variant="numericTitle">{fgEuro(Math.abs(data.comparison.current))}</Text>
                  </Box>
                  <Box>
                    <Text variant="caption" color="muted">Last month</Text>
                    <Text variant="numericTitle">{fgEuro(Math.abs(data.comparison.previous))}</Text>
                  </Box>
                  <Box style={{ alignItems: "flex-end" }}>
                    <Text variant="caption" color="muted">Change</Text>
                    <Text variant="numericTitle" color={change > 0 ? "expense" : "income"}>
                      {data.comparison.previous === 0 && data.comparison.current !== 0 ? "new" : `${change > 0 ? "+" : ""}${change} %`}
                    </Text>
                  </Box>
                </Box>
                {data.comparison.categories.slice(0, 5).map((row) => (
                  <Box key={row.category} row style={{ justifyContent: "space-between" }}>
                    <Text variant="body3">{row.category}</Text>
                    <Text variant="body3" color={row.changePercent > 0 ? "expense" : "income"}>
                      {`${row.changePercent > 0 ? "+" : ""}${Math.round(row.changePercent)} %`}
                    </Text>
                  </Box>
                ))}
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={120}>
            <FgSection title="Where your money goes">
              <Card>
                {data.categories.length ? data.categories.slice(0, 6).map((row) => (
                  <Box key={row.category} gap={4}>
                    <Box row style={{ justifyContent: "space-between" }}>
                      <Text variant="body3">{row.category}</Text>
                      <Text variant="body4" color="muted">{fgEuro(Math.abs(row.cents))}</Text>
                    </Box>
                    <Progress value={data.totals.expense ? (Math.abs(row.cents) / Math.abs(data.totals.expense)) * 100 : 0} />
                  </Box>
                )) : <Text variant="body3" color="muted">No spending recorded yet.</Text>}
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={180}>
            <FgSection title="Smart analysis">
              <Card>
                {data.tips.map((tip) => (
                  <Box key={tip} row gap={8} style={{ alignItems: "flex-start" }}>
                    <Icon name="lightbulb-outline" size={18} color="#7B3FE4" />
                    <Text variant="body3" style={{ flex: 1 }}>{tip}</Text>
                  </Box>
                ))}
              </Card>
            </FgSection>
          </FadeIn>
          {data.budgetStatus.length ? (
            <FadeIn delay={220}>
              <FgSection title="Budgets" action={<Text variant="body4" color="muted">local</Text>}>
                <Card>
                  {data.budgetStatus.map((row) => (
                    <Box key={row.category} gap={4}>
                      <Box row style={{ justifyContent: "space-between" }}>
                        <Text variant="body3">{row.category}</Text>
                        <Text variant="body4" color="muted">{`${fgEuro(row.spent)} / ${fgEuro(row.limit)}`}</Text>
                      </Box>
                      <Progress value={row.percent} color={row.percent > 100 ? "#D93050" : undefined} />
                    </Box>
                  ))}
                </Card>
              </FgSection>
            </FadeIn>
          ) : null}
        </>}
      </AsyncBoundary>
    </FgScreen>
  );
}
