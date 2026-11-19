import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Card, FadeIn, FgCategoryChip, FgCategoryPill, FgHeaderIcon, FgMerchantRow, FgScreen, Text } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { CATEGORY_CHOICES, loadCategorised, setMerchantCategory } from "../lib/finanzguru";

type Data = Awaited<ReturnType<typeof loadCategorised>>;

export default function CategorisedScreen() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void loadCategorised()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your transactions"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const cycle = async (merchant: string, current: string) => {
    const index = CATEGORY_CHOICES.indexOf(current);
    const next = CATEGORY_CHOICES[(index + 1) % CATEGORY_CHOICES.length];
    await setMerchantCategory(merchant, next);
    load();
  };

  return (
    <FgScreen
      title="Automatically categorised"
      actions={<FgHeaderIcon name="cog-outline" label="Settings" onPress={() => router.push("/settings")} />}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {data && <>
          <FadeIn>
            <Card style={{ gap: 12, alignItems: "center" }}>
              <Text variant="body3" color="muted">{`${data.categorised} of ${data.total} transactions categorised locally`}</Text>
              <FgCategoryChip emoji="🏠" label="Living" align="right" />
              <FgCategoryChip emoji="😊" label="Leisure" align="left" />
              <FgCategoryChip emoji="🥤" label="Food & Drinks" />
            </Card>
          </FadeIn>
          <FadeIn delay={80}>
            <Card style={{ paddingHorizontal: 8 }}>
              {data.merchants.length ? data.merchants.map((merchant) => (
                <FgMerchantRow
                  key={merchant.merchant}
                  emoji={merchant.merchant.slice(0, 1).toUpperCase()}
                  name={merchant.merchant}
                  category={`${merchant.count} booking${merchant.count === 1 ? "" : "s"} · ${fgEuro(Math.abs(merchant.cents))}`}
                  pill={<FgCategoryPill label={merchant.category} />}
                  onPress={() => void cycle(merchant.merchant, merchant.category)}
                />
              )) : <Text variant="body3" color="muted">No expenses recorded yet. Add a transaction to see automatic categorisation here.</Text>}
            </Card>
          </FadeIn>
          <FadeIn delay={140}>
            <Text variant="body5" color="muted">Tap a category pill to reassign it. Changes are saved to local SQLite and used by Insights.</Text>
          </FadeIn>
        </>}
      </AsyncBoundary>
    </FgScreen>
  );
}
