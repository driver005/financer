import { useCallback, useState } from "react";
import { View } from "react-native";
import { Chip, HelperText, List, Text, TextInput } from "@/components/kit";

import type { Affordability } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, useColors } from "@/components/ui";
import { chainLabel } from "@/hooks";
import { formatCents, formatDate, parseEuroInput } from "@/format";

const BASKET_NOTE: Record<string, string> = {
  manual: "Based on the usual items you entered.",
  receipts: "Based on what your receipts show you buy.",
  starter: "Based on a generic one-person basket. Add your usual items or receipts for personal results.",
};

/** "What can I buy with my budget?": basket per chain, cheapest items and the best split. */
export function Afford() {
  const { api } = useApi();
  const c = useColors();
  const [budgetText, setBudgetText] = useState("");
  const [result, setResult] = useState<Affordability | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const run = useCallback(async () => {
    if (!api) return;
    let cents: number | undefined;
    if (budgetText.trim()) {
      const parsed = parseEuroInput(budgetText);
      if (parsed === null) {
        setMessage("Enter the budget as euros, e.g. 80 or 80,50");
        return;
      }
      cents = parsed;
    }
    setBusy(true);
    try {
      setResult(await api.affordability(cents));
      setMessage(null);
    } catch (e) {
      setResult(null);
      setMessage(e instanceof Error ? e.message : "Could not calculate");
    } finally {
      setBusy(false);
    }
  }, [api, budgetText]);

  const cheapestComplete = result?.per_chain.find((p) => p.missing.length === 0);
  const staples = result ? (showAll ? result.staples : result.staples.slice(0, 6)) : [];

  return (
    <Card>
      <Text variant="titleLarge" accessibilityRole="header">
        What can I buy?
      </Text>
      <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 4 }}>
        Leave the amount empty to use what is left of this month's groceries limit.
      </Text>
      <TextInput
        mode="outlined"
        label="Budget in euro (optional)"
        accessibilityLabel="Budget in euro (optional)"
        value={budgetText}
        onChangeText={setBudgetText}
        keyboardType="decimal-pad"
        style={{ marginTop: 12 }}
      />
      <View style={{ marginTop: 12 }}>
        <Button label={busy ? "Calculating…" : "Show what it buys"} icon="cart-outline" onPress={run} disabled={busy} />
      </View>
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}

      {result ? (
        <View style={{ marginTop: 16 }}>
          <Body bold>Budget {formatCents(result.budget_cents)}</Body>
          <Text variant="bodySmall" style={{ color: c.muted, marginBottom: 8 }}>
            {BASKET_NOTE[result.basket_source] ?? ""}
          </Text>

          {result.per_chain.length === 0 ? (
            <Body muted>No prices yet. Refresh the prices first.</Body>
          ) : (
            result.per_chain.map((p) => (
              <List.Item
                key={p.chain}
                title={chainLabel(p.chain)}
                description={
                  p.missing.length
                    ? `No price for ${p.missing.length} of your items`
                    : `${formatCents(p.basket_cents)} per basket · ${p.baskets}× = ${p.days_covered} days`
                }
                left={() => <List.Icon icon={p === cheapestComplete ? "star" : "store-outline"} />}
                accessibilityLabel={`${chainLabel(p.chain)}: ${formatCents(p.basket_cents)} per basket`}
              />
            ))
          )}

          {result.plan ? (
            <View style={{ marginTop: 8 }}>
              <Body bold>Cheapest way to shop: {formatCents(result.plan.total_cents)}</Body>
              {result.plan.single_chain_total_cents != null &&
              result.plan.single_chain_total_cents > result.plan.total_cents ? (
                <Text variant="bodySmall" style={{ color: c.good }}>
                  {formatCents(result.plan.single_chain_total_cents - result.plan.total_cents)} less than one stop
                </Text>
              ) : null}
              {result.plan.stops.map((s) => (
                <View key={s.chain} style={{ marginTop: 8 }}>
                  <Text variant="titleSmall">{chainLabel(s.chain)}</Text>
                  {s.items.map((i) => (
                    <Text key={i.item} variant="bodyMedium" style={{ color: c.muted }}>
                      {i.name} · {formatCents(i.price_cents)}
                      {i.is_offer ? ` · offer${i.valid_until ? ` until ${formatDate(i.valid_until)}` : ""}` : ""}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : result.per_chain.length ? (
            <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
              No complete plan: some basket items have no price anywhere yet.
            </Text>
          ) : null}

          {staples.length ? (
            <View style={{ marginTop: 16 }}>
              <Body bold>Cheapest items within the budget</Body>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {staples.map((s) => (
                  <Chip key={`${s.item}-${s.chain}`} compact accessibilityLabel={`${s.name} at ${chainLabel(s.chain)}`}>
                    {s.name} {formatCents(s.price_cents)} · {chainLabel(s.chain)}
                  </Chip>
                ))}
              </View>
              {result.staples.length > 6 ? (
                <Button mode="text" label={showAll ? "Show fewer" : "Show more"} onPress={() => setShowAll((v) => !v)} />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
