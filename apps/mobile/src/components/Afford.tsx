import { useCallback, useState } from "react";
import { Box, Button, Chip, ChipRow, ListItem, Note, Section, Text, TextField } from "@financer/ui";

import type { Affordability } from "@/api/client";
import { useApi } from "@/api/config";
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
    <Section title="What can I buy?" description="Leave the amount empty to use what is left of this budget period's groceries limit." card>
      <TextField label="Budget in euro (optional)" value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" />
      <Button label={busy ? "Calculating…" : "Show what it buys"} icon="cart-outline" onPress={run} disabled={busy} />
      {message ? <Note tone="error">{message}</Note> : null}

      {result ? (
        <Box gap="md">
          <Box gap="2xs">
            <Text variant="bodyStrong">{`Budget ${formatCents(result.budget_cents)}`}</Text>
            <Text variant="caption" tone="muted">{BASKET_NOTE[result.basket_source] ?? ""}</Text>
          </Box>

          {result.per_chain.length === 0 ? (
            <Text variant="body" tone="muted">No prices yet. Refresh the prices first.</Text>
          ) : (
            result.per_chain.map((p) => (
              <ListItem
                key={p.chain}
                icon={p === cheapestComplete ? "star" : "store-outline"}
                title={chainLabel(p.chain)}
                subtitle={p.missing.length ? `No price for ${p.missing.length} of your items` : `${formatCents(p.basket_cents)} per basket · ${p.baskets}× = ${p.days_covered} days`}
                label={`${chainLabel(p.chain)}: ${formatCents(p.basket_cents)} per basket`}
              />
            ))
          )}

          {result.plan ? (
            <Box gap="sm">
              <Text variant="bodyStrong">{`Cheapest way to shop: ${formatCents(result.plan.total_cents)}`}</Text>
              {result.plan.single_chain_total_cents != null && result.plan.single_chain_total_cents > result.plan.total_cents ? (
                <Text variant="caption" tone="success">{`${formatCents(result.plan.single_chain_total_cents - result.plan.total_cents)} less than one stop`}</Text>
              ) : null}
              {result.plan.stops.map((s) => (
                <Box key={s.chain} gap="2xs">
                  <Text variant="label">{chainLabel(s.chain)}</Text>
                  {s.items.map((i) => (
                    <Text key={i.item} variant="caption" tone="muted">
                      {`${i.name} · ${formatCents(i.price_cents)}${i.is_offer ? ` · offer${i.valid_until ? ` until ${formatDate(i.valid_until)}` : ""}` : ""}`}
                    </Text>
                  ))}
                </Box>
              ))}
            </Box>
          ) : result.per_chain.length ? (
            <Text variant="caption" tone="muted">No complete plan: some basket items have no price anywhere yet.</Text>
          ) : null}

          {staples.length ? (
            <Box gap="sm">
              <Text variant="bodyStrong">Cheapest items within the budget</Text>
              <ChipRow>
                {staples.map((s) => (
                  <Chip key={`${s.item}-${s.chain}`} label={`${s.name} ${formatCents(s.price_cents)} · ${chainLabel(s.chain)}`} />
                ))}
              </ChipRow>
              {result.staples.length > 6 ? <Button variant="ghost" size="sm" label={showAll ? "Show fewer" : "Show more"} onPress={() => setShowAll((v) => !v)} /> : null}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Section>
  );
}
