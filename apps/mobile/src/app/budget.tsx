import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { HelperText, SegmentedButtons, Text, TextInput } from "@/components/kit";

import type { BudgetPeriod, Disposable, EnvelopeStatus } from "@/api/client";
import { useApi } from "@/api/config";
import { Afford } from "@/components/Afford";
import { Bar, Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, parseEuroInput } from "@/format";
import { useScreenData } from "@/hooks";
import { localIsoDate, periodLabel } from "@/period";

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
  const c = useColors();
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

  if (!loaded) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Title>Budget</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <Afford />

          {data ? (
            <Card>
              <Text variant="titleMedium">Per month (from recurring payments)</Text>
              <Row label="Income" value={formatCents(data.disposable.monthly_income_cents)} />
              <Row label="Fixed costs" value={formatCents(-data.disposable.monthly_fixed_costs_cents)} />
              <Row label="Left to budget" value={formatCents(data.disposable.disposable_cents)} bold />
            </Card>
          ) : busy ? (
            <Loading />
          ) : null}

          <Card>
            <Text variant="titleMedium">Limits per budget period</Text>
            {shown ? (
              <>
                <SegmentedButtons
                  style={{ marginTop: 12 }}
                  value={which}
                  onValueChange={setWhich}
                  buttons={[
                    { value: "current", label: "This period" },
                    { value: "previous", label: "Last period" },
                  ]}
                />
                <Text variant="bodyMedium" style={{ marginTop: 8, fontWeight: "700" }} accessibilityLabel={`Budget period ${periodLabel(shown)}`}>
                  {periodLabel(shown)}
                  {which === "current" ? ` · ${shown.days_left} ${shown.days_left === 1 ? "day" : "days"} left` : ""}
                </Text>
                {shown.payday > 1 ? (
                  <Text variant="bodySmall" style={{ color: c.muted }}>
                    Your budget month starts on day {shown.payday} (change it in Settings).
                  </Text>
                ) : null}
              </>
            ) : null}
            {CATEGORIES.map((cat) => {
              const s = data?.status[which].find((x) => x.category === cat);
              const over = s ? s.remaining_cents < 0 : false;
              const progress = s && s.limit_cents > 0 ? Math.min(1, s.spent_cents / s.limit_cents) : 0;
              return (
                <View key={cat} style={{ marginTop: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Text variant="bodyLarge" style={{ flex: 1, textTransform: "capitalize" }}>{cat}</Text>
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
                      <Bar progress={progress} color={over ? c.bad : c.accent} />
                      <Text variant="bodySmall" style={{ color: over ? c.bad : c.muted, marginTop: 2 }}>
                        {formatCents(s.spent_cents)} spent ·{" "}
                        {over ? `${formatCents(-s.remaining_cents)} over` : `${formatCents(s.remaining_cents)} left`}
                      </Text>
                    </>
                  ) : null}
                </View>
              );
            })}
            <View style={{ marginTop: 16 }}>
              <Button label="Save limits" icon="content-save-outline" onPress={save} disabled={saving} />
            </View>
            <HelperText type={message?.startsWith("Budget saved") ? "info" : "error"} visible={!!(message ?? error)}>
              {message ?? error}
            </HelperText>
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
      <Body muted={!bold} bold={bold}>{label}</Body>
      <Body bold={bold}>{value}</Body>
    </View>
  );
}
