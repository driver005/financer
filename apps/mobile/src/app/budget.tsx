import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";

import type { Disposable, EnvelopeStatus } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, parseEuroInput } from "@/format";

// Categories that can have a monthly limit (income and savings are not spending).
const CATEGORIES = [
  "groceries", "dining", "transport", "housing", "utilities", "insurance",
  "subscriptions", "health", "leisure", "shopping", "cash", "other",
] as const;

export default function Budget() {
  const { api, loaded } = useApi();
  const c = useColors();
  const [disposable, setDisposable] = useState<Disposable | null>(null);
  const [status, setStatus] = useState<EnvelopeStatus[]>([]);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const now = new Date();
      const [d, envelopes, st] = await Promise.all([
        api.disposable(),
        api.envelopes(),
        api.budgetStatus(now.getFullYear(), now.getMonth() + 1),
      ]);
      setDisposable(d);
      setStatus(st);
      setLimits(Object.fromEntries(envelopes.map((e) => [e.category, (e.limit_cents / 100).toFixed(2).replace(".", ",")])));
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load budget");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function save() {
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
    setBusy(true);
    try {
      await api.saveEnvelopes(envelopes);
      await load();
      setMessage("Budget saved");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save budget");
      setBusy(false);
    }
  }

  if (!loaded) return <Screen><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;

  return (
    <Screen>
      <Title>Budget</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {disposable ? (
            <Card>
              <Body bold>Per month (from recurring payments)</Body>
              <Row label="Income" value={formatCents(disposable.monthly_income_cents)} />
              <Row label="Fixed costs" value={formatCents(-disposable.monthly_fixed_costs_cents)} />
              <Row label="Left to budget" value={formatCents(disposable.disposable_cents)} bold />
            </Card>
          ) : null}

          <Card>
            <Body bold>Monthly limits</Body>
            {CATEGORIES.map((cat) => {
              const s = status.find((x) => x.category === cat);
              const over = s ? s.remaining_cents < 0 : false;
              return (
                <View key={cat} style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Text style={{ color: c.text, flex: 1, textTransform: "capitalize" }}>{cat}</Text>
                    <TextInput
                      value={limits[cat] ?? ""}
                      onChangeText={(t) => setLimits((l) => ({ ...l, [cat]: t }))}
                      placeholder="–"
                      placeholderTextColor={c.muted}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`Monthly limit for ${cat} in euro`}
                      style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8, width: 100, color: c.text, textAlign: "right" }}
                    />
                  </View>
                  {s ? (
                    <Text style={{ color: over ? c.bad : c.muted, fontSize: 13, marginTop: 2 }}>
                      {formatCents(s.spent_cents)} spent · {over ? `${formatCents(-s.remaining_cents)} over` : `${formatCents(s.remaining_cents)} left`}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            <View style={{ marginTop: 14 }}>
              <Button label="Save limits" onPress={save} disabled={busy} />
            </View>
          </Card>
          {message ? <Text style={{ color: c.muted, marginBottom: 16 }}>{message}</Text> : null}
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
