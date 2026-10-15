import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text as RNText, View } from "react-native";
import { HelperText, SegmentedButtons, TextInput } from "@/components/kit";

import type { BudgetPeriod, Disposable, EnvelopeStatus } from "@/api/client";
import { useApi } from "@/api/config";
import { Afford } from "@/components/Afford";
import { CompareBars } from "@/components/Charts";
import { EmptyState } from "@/components/EmptyState";
import { Money } from "@/components/Money";
import { IconBadge } from "@/components/rows";
import { SkeletonList } from "@/components/Skeleton";
import { Bar, Button, Card, LedgerRow, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { categoryIcon, categoryLabel } from "@/categoryIcons";
import { compareSummary, topCategories } from "@/charts";
import { parseEuroInput, spokenMoney } from "@/format";
import { useScreenData } from "@/hooks";
import { localIsoDate, periodLabel } from "@/period";
import { space, typography, usePalette } from "@/theme";

// Categories that can have a monthly limit (income and savings are not spending).
const CATEGORIES = [
  "groceries", "dining", "transport", "housing", "utilities", "insurance",
  "subscriptions", "health", "leisure", "shopping", "cash", "other",
] as const;

type Which = "current" | "previous";
type BudgetData = {
  disposable: Disposable;
  limits: Record<string, string>;
  status: Record<Which, EnvelopeStatus[]>;
  period: Record<Which, BudgetPeriod>;
};

export default function Budget() {
  const { api, loaded } = useApi();
  const p = usePalette();
  const { data, error, busy, reload } = useScreenData<BudgetData>(async (a) => {
    const today = localIsoDate();
    const [disposable, envelopes, current, previous, statusNow, statusBefore] = await Promise.all([
      a.disposable(),
      a.envelopes(),
      a.budgetPeriod("current", today),
      a.budgetPeriod("previous", today),
      a.budgetStatusFor("current", today),
      a.budgetStatusFor("previous", today),
    ]);
    const limits = Object.fromEntries(
      envelopes.map((e) => [e.category, (e.limit_cents / 100).toFixed(2).replace(".", ",")]),
    );
    return {
      disposable,
      limits,
      status: { current: statusNow, previous: statusBefore },
      period: { current, previous },
    };
  });
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [which, setWhich] = useState<Which>("current");
  const shown = data?.period[which];

  useEffect(() => {
    if (data) setLimits(data.limits);
  }, [data]);

  const save = useCallback(async () => {
    if (!api) return;
    const envelopes = [];
    for (const category of CATEGORIES) {
      const raw = (limits[category] ?? "").trim();
      if (!raw) continue;
      const cents = parseEuroInput(raw);
      if (cents === null) {
        setMessage(`"${raw}" is not a valid amount for ${category}`);
        return;
      }
      envelopes.push({ category, limit_cents: cents });
    }
    setSaving(true);
    try {
      await api.saveEnvelopes(envelopes);
      await reload();
      setMessage("Budget saved");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save budget");
    } finally {
      setSaving(false);
    }
  }, [api, limits, reload]);

  const compare = useMemo(() => (data ? topCategories(data.status.current, data.status.previous, 5) : []), [data]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const left = data?.disposable.disposable_cents ?? 0;
  const currentPeriod = data?.period.current;

  return (
    <Screen>
      <Title subtitle={currentPeriod ? periodLabel(currentPeriod) : undefined}>Budget</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.xl }}
          refreshControl={<RefreshControl refreshing={busy && !!data} onRefresh={() => void reload()} tintColor={p.accent} />}
        >
          {data ? (
            <>
              <Card>
                <RNText style={[typography.overline, { color: p.muted }]}>Left to budget per month</RNText>
                <View style={{ marginTop: space.xs }}>
                  <Money cents={left} variant="display" tone={left < 0 ? "bad" : "plain"} label={`Left to budget per month: ${spokenMoney(left)}`} />
                </View>
                <RNText style={[typography.caption, { color: p.muted, marginTop: space.xs }]}>From your recurring payments: income minus fixed costs.</RNText>
                <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: p.border }}>
                  <LedgerRow label="Income" value={<Money cents={data.disposable.monthly_income_cents} variant="bodyStrong" signed />} />
                  <View style={{ height: 1, backgroundColor: p.border }} />
                  <LedgerRow label="Fixed costs" value={<Money cents={-data.disposable.monthly_fixed_costs_cents} variant="bodyStrong" tone="plain" />} />
                </View>
              </Card>
            </>
          ) : error ? (
            <EmptyState title="Could not load your budget" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} />
          ) : (
            <View style={{ gap: space.md, marginBottom: space.md }}>
              <SkeletonList rows={2} />
            </View>
          )}

          <Card>
            <RNText accessibilityRole="header" style={[typography.heading, { color: p.text }]}>Limits per budget period</RNText>
            {shown ? (
              <>
                <SegmentedButtons
                  style={{ marginTop: space.md }}
                  value={which}
                  onValueChange={setWhich}
                  buttons={[
                    { value: "current", label: "This period" },
                    { value: "previous", label: "Last period" },
                  ]}
                />
                <RNText style={[typography.bodyStrong, { color: p.text, marginTop: space.md }]} accessibilityLabel={`Budget period ${periodLabel(shown)}`}>
                  {periodLabel(shown)}
                  {which === "current" ? ` · ${shown.days_left} ${shown.days_left === 1 ? "day" : "days"} left` : ""}
                </RNText>
                {shown.payday > 1 ? (
                  <RNText style={[typography.caption, { color: p.muted }]}>
                    Your budget month starts on day {shown.payday} (change it in Settings).
                  </RNText>
                ) : null}
              </>
            ) : null}
            {CATEGORIES.map((cat) => {
              const s = data?.status[which].find((x) => x.category === cat);
              const over = s ? s.remaining_cents < 0 : false;
              const progress = s && s.limit_cents > 0 ? Math.min(1, s.spent_cents / s.limit_cents) : 0;
              const ic = categoryIcon(cat);
              return (
                <View key={cat} style={{ marginTop: space.lg }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                    <IconBadge icon={ic.icon} tone={ic.tone} size={36} />
                    <RNText numberOfLines={2} style={[typography.bodyStrong, { color: p.text, flex: 1 }]}>{categoryLabel(cat)}</RNText>
                    <TextInput
                      mode="outlined"
                      dense
                      value={limits[cat] ?? ""}
                      onChangeText={(t) => setLimits((l) => ({ ...l, [cat]: t }))}
                      placeholder="–"
                      keyboardType="decimal-pad"
                      right={<TextInput.Affix text="€" />}
                      style={{ width: 120 }}
                      accessibilityLabel={`Monthly limit for ${cat} in euro`}
                    />
                  </View>
                  {s ? (
                    <>
                      <Bar
                        progress={progress}
                        color={over ? p.bad : p.accent}
                        marginTop={space.sm}
                        accessibilityLabel={`${categoryLabel(cat)}: ${Math.round(progress * 100)} percent of the limit used`}
                      />
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.xs, alignItems: "center" }}>
                        <Money cents={s.spent_cents} variant="caption" tone="muted" />
                        <RNText style={[typography.caption, { color: over ? p.bad : p.muted }]}>spent ·</RNText>
                        <Money cents={over ? -s.remaining_cents : s.remaining_cents} variant="caption" tone={over ? "bad" : "muted"} />
                        <RNText style={[typography.caption, { color: over ? p.bad : p.muted }]}>{over ? "over" : "left"}</RNText>
                      </View>
                    </>
                  ) : null}
                </View>
              );
            })}
            <View style={{ marginTop: space.xl }}>
              <Button label="Save limits" icon="content-save-outline" onPress={save} disabled={saving} />
            </View>
            <HelperText type={message?.startsWith("Budget saved") ? "info" : "error"} visible={!!(message ?? error)}>
              {message ?? error}
            </HelperText>
          </Card>

          {compare.length > 0 ? (
            <Card>
              <RNText accessibilityRole="header" style={[typography.heading, { color: p.text }]}>This period against last</RNText>
              <RNText style={[typography.caption, { color: p.muted, marginTop: 2, marginBottom: space.lg }]}>Your biggest categories with a limit.</RNText>
              <CompareBars rows={compare} summary={compareSummary(compare)} />
            </Card>
          ) : null}

          <Afford />
        </ScrollView>
      )}
    </Screen>
  );
}
