import { useState } from "react";
import { ChipRow, Segmented, Text, TextField } from "@financer/ui";

import { FieldLabel, NumberTiles, Note, StepFrame, ToggleChip } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { CHAINS, CHAIN_NAMES, HOUSEHOLD_MAX, mascotFor, parseBudget, parsePostalCode, type Cadence } from "@/onboarding";

function centsToInput(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function HouseholdStep({ ctx }: { ctx: StepCtx }) {
  const { draft, update } = ctx;
  const [budgetText, setBudgetText] = useState(centsToInput(draft.groceryBudgetCents));
  const [postal, setPostal] = useState(draft.postalCode ?? "");
  const budget = parseBudget(budgetText);
  const postalCheck = parsePostalCode(postal);
  const cadence: Cadence = draft.groceryCadence ?? "monthly";
  const chains = draft.chains ?? [];

  function onBudget(text: string) {
    setBudgetText(text);
    const r = parseBudget(text);
    if (r.ok) update({ groceryBudgetCents: r.value ?? undefined });
  }

  function onPostal(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 5);
    setPostal(digits);
    const r = parsePostalCode(digits);
    if (r.ok) update({ postalCode: r.value ?? undefined });
  }

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("household", draft, ctx.build)}
      title="Who do you shop for?"
      why="Household size and your stores shape the grocery plan and the starting point for your daily number."
      primary={{ label: "Continue", onPress: ctx.next, disabled: !budget.ok || !postalCheck.ok, icon: "arrow-right" }}
      onSkip={ctx.next}
    >
      <FieldLabel>People in your household</FieldLabel>
      <NumberTiles
        values={Array.from({ length: HOUSEHOLD_MAX }, (_, i) => i + 1)}
        value={draft.householdSize}
        onChange={(n) => update({ householdSize: n })}
        label={(n) => `${n} ${n === 1 ? "person" : "people"}`}
      />

      <FieldLabel>Grocery budget</FieldLabel>
      <Segmented<Cadence>
        value={cadence}
        onChange={(v) => update({ groceryCadence: v })}
        options={[
          { value: "weekly", label: "Per week" },
          { value: "monthly", label: "Per month" },
        ]}
      />
      <TextField
        label={cadence === "weekly" ? "Budget per week" : "Budget per month"}
        value={budgetText}
        onChangeText={onBudget}
        keyboardType="decimal-pad"
        placeholder="e.g. 60"
        error={!budget.ok ? budget.error : undefined}
        right={<Text variant="label" tone="muted">€</Text>}
      />
      <Note icon="help-circle-outline">Why we ask: your budget is the starting point for the daily number on the next screen. Leave it empty and I will suggest one.</Note>

      <FieldLabel>Where do you shop?</FieldLabel>
      <ChipRow>
        {CHAINS.map((c) => {
          const on = chains.includes(c);
          return (
            <ToggleChip
              key={c}
              label={CHAIN_NAMES[c]}
              selected={on}
              onPress={() => update({ chains: on ? chains.filter((x) => x !== c) : CHAINS.filter((x) => x === c || chains.includes(x)) })}
            />
          );
        })}
      </ChipRow>

      <FieldLabel>Postal code (optional)</FieldLabel>
      <TextField label="Postal code" value={postal} onChangeText={onPostal} keyboardType="number-pad" maxLength={5} placeholder="10115" error={!postalCheck.ok ? postalCheck.error : undefined} />
      <Note icon="map-marker-outline">
        Why we ask: prices differ a little by region. It stays on this device with your setup. Today's price sources cover whole chains, so it does not change any numbers yet.
      </Note>
    </StepFrame>
  );
}
