import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, CompareBars, HeroCaption, HeroCard, HeroChip, HeroFigure, HeroStats, IconBadge, Meter, Money, Note, Row, Section, Segmented, Text, TextField } from "@financer/ui";

import type { BudgetPeriod, Disposable, EnvelopeStatus } from "@/api/client";
import { useApi } from "@/api/config";
import { Afford } from "@/components/Afford";
import { Page } from "@/components/Page";
import { SectionSwitch } from "@/components/SectionSwitch";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { categoryIcon, categoryLabel } from "@/categoryIcons";
import { compareSummary, topCategories } from "@/charts";
import { formatMoney, parseEuroInput, spokenMoney } from "@/format";
import { useScreenData } from "@/hooks";
import { localIsoDate, periodLabel } from "@/period";
import { asIcon, toTone } from "@/uiTone";

// Categories that can have a monthly limit (income and savings are not spending).
const CATEGORIES = ["groceries", "dining", "transport", "housing", "utilities", "insurance", "subscriptions", "health", "leisure", "shopping", "cash", "other"] as const;

type Which = "current" | "previous";
type BudgetData = {
  disposable: Disposable;
  limits: Record<string, string>;
  status: Record<Which, EnvelopeStatus[]>;
  period: Record<Which, BudgetPeriod>;
};

export default function Budget() {
  const { api, loaded } = useApi();
  const { data, error, reload } = useScreenData<BudgetData>(async (a) => {
    const today = localIsoDate();
    const [now, before] = await Promise.all([a.budget("current", today), a.budget("previous", today)]);
    const { disposable, envelopes } = now;
    const limits = Object.fromEntries(envelopes.map((e) => [e.category, (e.limit_cents / 100).toFixed(2).replace(".", ",")]));
    return { disposable, limits, status: { current: now.envelopes, previous: before.envelopes }, period: { current: now.period, previous: before.period } };
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

  if (!loaded) return <Page title="Budget"><Loading /></Page>;
  if (!api) return <Page title="Budget"><SectionSwitch /><NeedsSetup /></Page>;

  const left = data?.disposable.disposable_cents ?? 0;
  const currentPeriod = data?.period.current;

  return (
    <Page title="Budget" subtitle={currentPeriod ? periodLabel(currentPeriod) : undefined}>
      <SectionSwitch />
      {data ? (
        <HeroCard label="Left to budget per month" chip={left < 0 ? <HeroChip icon="alert-outline" text="Over" /> : null}>
          <HeroFigure cents={left} label={`Left to budget per month: ${spokenMoney(left)}`} />
          <HeroCaption>From your recurring payments: income minus fixed costs.</HeroCaption>
          <HeroStats
            items={[
              { label: "Income", value: formatMoney(data.disposable.monthly_income_cents), spoken: spokenMoney(data.disposable.monthly_income_cents) },
              { label: "Fixed costs", value: formatMoney(data.disposable.monthly_fixed_costs_cents), spoken: spokenMoney(data.disposable.monthly_fixed_costs_cents) },
            ]}
          />
        </HeroCard>
      ) : error ? (
        <Empty title="Could not load your budget" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} />
      ) : (
        <Loading rows={2} />
      )}

      <Section title="Limits per budget period" card>
        {shown ? (
          <>
            <Segmented<Which>
              value={which}
              onChange={setWhich}
              options={[
                { value: "current", label: "This period" },
                { value: "previous", label: "Last period" },
              ]}
            />
            <Text variant="bodyStrong" accessibilityLabel={`Budget period ${periodLabel(shown)}`}>
              {`${periodLabel(shown)}${which === "current" ? ` · ${shown.days_left} ${shown.days_left === 1 ? "day" : "days"} left` : ""}`}
            </Text>
            {shown.payday > 1 ? <Text variant="caption" tone="muted">{`Your budget month starts on day ${shown.payday} (change it in Settings).`}</Text> : null}
          </>
        ) : null}
        {CATEGORIES.map((cat) => {
          const s = data?.status[which].find((x) => x.category === cat);
          const over = s ? s.remaining_cents < 0 : false;
          const progress = s && s.limit_cents > 0 ? Math.min(1, s.spent_cents / s.limit_cents) : 0;
          const ic = categoryIcon(cat);
          return (
            <Box key={cat} gap="sm">
              <Row gap="md">
                <IconBadge icon={asIcon(ic.icon)} tone={toTone(ic.tone)} />
                <Box grow><Text variant="bodyStrong" numberOfLines={2}>{categoryLabel(cat)}</Text></Box>
                <Box basis="half">
                  <TextField value={limits[cat] ?? ""} onChangeText={(t) => setLimits((l) => ({ ...l, [cat]: t }))} placeholder="–" keyboardType="decimal-pad" right={<Text variant="label" tone="muted">€</Text>} />
                </Box>
              </Row>
              {s ? (
                <>
                  <Meter value={progress} tone={over ? "danger" : "accent"} label={`${categoryLabel(cat)}: ${Math.round(progress * 100)} percent of the limit used`} />
                  <Row gap="xs" wrap>
                    <Money cents={s.spent_cents} variant="caption" tone="muted" />
                    <Text variant="caption" tone={over ? "danger" : "muted"}>spent ·</Text>
                    <Money cents={over ? -s.remaining_cents : s.remaining_cents} variant="caption" tone={over ? "bad" : "muted"} />
                    <Text variant="caption" tone={over ? "danger" : "muted"}>{over ? "over" : "left"}</Text>
                  </Row>
                </>
              ) : null}
            </Box>
          );
        })}
        <Button label="Save limits" icon="content-save-outline" onPress={save} disabled={saving} />
        {message ?? error ? <Note tone={message?.startsWith("Budget saved") ? "ok" : "error"}>{(message ?? error) as string}</Note> : null}
      </Section>

      {compare.length > 0 ? (
        <Section title="This period against last" description="Your biggest categories with a limit." card>
          <CompareBars
            summary={compareSummary(compare)}
            rows={compare.map((r) => ({ key: r.category, label: categoryLabel(r.category), current: r.current, previous: r.previous, value: <Money cents={r.current} variant="label" tone="plain" /> }))}
          />
        </Section>
      ) : null}

      <Afford />
    </Page>
  );
}
