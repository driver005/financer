import { useEffect, useState } from "react";
import { Text as RNText, View } from "react-native";

import { useApi } from "@/api/config";
import { HelperText, TextInput } from "@/components/kit";
import { PaydayPicker } from "@/components/PaydayPicker";
import { ChoiceCard, FieldLabel, Note, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { formatCents } from "@/format";
import { dailyAllowanceOn } from "@/game";
import { INTENSITIES, groceryLimitFor, mascotFor, parseBudget, suggestAllowance, type Intensity } from "@/onboarding";
import { budgetPeriod, localIsoDate, periodDays, periodLabel } from "@/period";
import { usePalette } from "@/theme";

export function RhythmStep({ ctx }: { ctx: StepCtx }) {
  const { draft, update } = ctx;
  const { api } = useApi();
  const p = usePalette();
  const today = localIsoDate();
  const payday = draft.payday ?? 1;
  const [allowanceText, setAllowanceText] = useState(draft.dailyAllowanceCents === undefined ? "" : (draft.dailyAllowanceCents / 100).toFixed(2).replace(".", ","));
  const allowance = parseBudget(allowanceText);

  // On a replay, start from the payday the app already has.
  useEffect(() => {
    if (draft.payday !== undefined || !api) return;
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) update({ payday: s.payday });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function pick(intensity: Intensity) {
    const cents = suggestAllowance({
      intensity,
      householdSize: draft.householdSize,
      groceryBudgetCents: draft.groceryBudgetCents,
      groceryCadence: draft.groceryCadence,
    });
    update({ intensity, dailyAllowanceCents: cents });
    setAllowanceText((cents / 100).toFixed(2).replace(".", ","));
  }

  function onAllowance(text: string) {
    setAllowanceText(text);
    const r = parseBudget(text);
    if (r.ok && r.value !== null) update({ dailyAllowanceCents: r.value });
  }

  // The number the Today screen will show, from the same helpers it uses.
  const limit = groceryLimitFor(draft, today);
  const period = budgetPeriod(today, payday);
  const daily = limit === null ? null : dailyAllowanceOn(limit, today, payday);

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("rhythm", draft, ctx.build)}
      title="What is your money rhythm?"
      why="Your budget month runs from payday to the day before the next one, so limits and the daily number line up with your salary."
      primary={{ label: "Continue", onPress: ctx.next, disabled: !allowance.ok, icon: "arrow-right" }}
      onSkip={ctx.next}
    >
      <FieldLabel>Payday</FieldLabel>
      <PaydayPicker value={payday} onChange={(day) => update({ payday: day })} />

      <FieldLabel>How hard do you want to save on groceries?</FieldLabel>
      {INTENSITIES.map((level) => {
        const suggestion = suggestAllowance({
          intensity: level.id,
          householdSize: draft.householdSize,
          groceryBudgetCents: draft.groceryBudgetCents,
          groceryCadence: draft.groceryCadence,
        });
        return (
          <ChoiceCard
            key={level.id}
            icon={level.icon}
            title={level.label}
            body={level.blurb}
            note={`About ${formatCents(suggestion)} a day`}
            selected={draft.intensity === level.id}
            onPress={() => pick(level.id)}
          />
        );
      })}

      {draft.intensity ? (
        <>
          <TextInput
            mode="outlined"
            label="Daily grocery goal"
            accessibilityLabel="Daily grocery goal in euros"
            value={allowanceText}
            onChangeText={onAllowance}
            keyboardType="decimal-pad"
            error={!allowance.ok}
            right={<TextInput.Affix text="€ a day" />}
          />
          {!allowance.ok ? <HelperText type="error" visible>{allowance.error}</HelperText> : null}
          {daily !== null && limit !== null ? (
            <View
              style={{ marginTop: 12, padding: 14, borderRadius: 20, borderWidth: 2, borderColor: p.border, backgroundColor: p.surface }}
              accessibilityLabel={`Your daily grocery goal is ${formatCents(daily)}`}
            >
              <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>YOUR DAILY GROCERY GOAL</RNText>
              <RNText style={{ color: p.text, fontSize: 30, fontWeight: "800", marginTop: 4 }}>{formatCents(daily)} a day</RNText>
              <RNText style={{ color: p.muted, fontSize: 13, marginTop: 4 }}>
                {formatCents(limit)} over {periodDays(period)} days ({periodLabel(period)}). This is what the Today screen counts down.
              </RNText>
            </View>
          ) : null}
        </>
      ) : null}
      <Note icon="calculator-variant-outline">
        Why we ask: the level is only a starting point and you can type your own number. Once Financer has seen your income, Today also shows what is safe to spend overall.
      </Note>
    </StepFrame>
  );
}
