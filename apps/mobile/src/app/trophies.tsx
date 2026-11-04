import { useRouter } from "expo-router";
import { useState } from "react";
import { Badge, Box, Button, Card, Group, HeroCard, HeroChip, HeroNumber, HeroProgress, ListItem, Mascot, Meter, Money, Note, Row, Section, Text, TextField } from "@financer/ui";

import type { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { BadgeIcon, FreezeRow } from "@/components/TrophiesCard";
import { formatDate, formatMoney, parseEuroInput } from "@/format";
import { FREEZE_EVERY, MAX_FREEZES, computeRewards, savedThisPeriod, trophyMessage, trophyMood } from "@/game";
import { useScreenData } from "@/hooks";
import { localIsoDate } from "@/period";
import { getSavingsGoal, setSavingsGoal } from "@/savingsGoal";

async function load(a: Api) {
  const [txs, budget, basket, prices, receipts, savingsGoal] = await Promise.all([
    a.transactions(),
    a.budget("current", localIsoDate()),
    a.basket(),
    a.prices(),
    a.receipts(),
    getSavingsGoal(),
  ]);
  const envelopes = budget.envelopes;
  return {
    txs,
    payday: budget.period.payday,
    savingsGoal,
    groceryLimit: envelopes.find((e) => e.category === "groceries")?.limit_cents ?? 0,
    progress: {
      transactions: txs.length,
      limits: envelopes.length,
      usualItems: basket.items.length,
      prices: prices.length,
      receipts: receipts.length,
    },
  };
}

/** Streak freezes, badges, personal bests and the savings goal. Everything is derived from the bookings. */
export default function Trophies() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const { data, error, reload } = useScreenData(load);
  const [goalText, setGoalText] = useState("");
  const [goalMessage, setGoalMessage] = useState<string | null>(null);

  if (!loaded) return <Page title="Trophies"><Loading /></Page>;
  if (!api) return <Page title="Trophies"><NeedsSetup /></Page>;

  const today = localIsoDate();
  const r = data ? computeRewards({ txs: data.txs, groceryLimit: data.groceryLimit, savingsGoal: data.savingsGoal, today, payday: data.payday, progress: data.progress }) : null;
  const saved = data ? savedThisPeriod(data.txs, today, data.payday) : 0;

  async function saveGoal() {
    const cents = goalText.trim() === "" ? 0 : parseEuroInput(goalText);
    if (cents === null) {
      setGoalMessage("Enter an amount like 150 or 150,50.");
      return;
    }
    try {
      await setSavingsGoal(cents);
      setGoalMessage(cents === 0 ? "Savings goal removed." : `Savings goal set to ${formatMoney(cents)} per budget period.`);
      setGoalText("");
      await reload();
    } catch {
      setGoalMessage("Could not save the goal on this device.");
    }
  }

  const earned = r ? r.badges.filter((b) => b.earned).length : 0;

  if (!data || !r) {
    return (
      <Page title="Trophies">
        {error ? <Empty title="Could not load your trophies" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} /> : <Loading rows={4} />}
      </Page>
    );
  }

  return (
    <Page title="Trophies" subtitle={`${earned} of ${r.badges.length} badges earned`}>
      <HeroCard label="Badges earned" chip={<HeroChip icon="trophy-outline" text={`${earned} / ${r.badges.length}`} />}>
        <HeroNumber value={`${earned}`} suffix={`of ${r.badges.length}`} label={`${earned} of ${r.badges.length} badges earned`} />
        <HeroProgress progress={r.badges.length > 0 ? earned / r.badges.length : 0} label={`${earned} of ${r.badges.length} badges earned`} />
      </HeroCard>

      <Mascot mood={trophyMood(r, false)} message={trophyMessage(r)} />

      <Card gap="md">
        <Text variant="label" tone="muted">Streak freezes</Text>
        <FreezeRow streak={r.streak} />
        <Text variant="caption" tone="muted">
          {`Every ${FREEZE_EVERY}th day in a row inside your daily grocery goal earns a freeze (you can keep ${MAX_FREEZES}). On a day you go over, a freeze is used automatically and your streak stays alive.${
            r.streak.usedOn.length > 0 ? ` Used ${r.streak.usedOn.length} time${r.streak.usedOn.length === 1 ? "" : "s"} so far.` : ""
          }`}
        </Text>
        {data.groceryLimit <= 0 ? <Note>Set a grocery limit to start a streak.</Note> : null}
      </Card>

      <Section title="Personal bests">
        <Group>
          <ListItem
            leading={<Text variant="title">🔥</Text>}
            title={`${r.bests.longestStreak} ${r.bests.longestStreak === 1 ? "day" : "days"}`}
            subtitle={`Longest streak${r.bests.longestStreakEndedOn ? `, ended ${formatDate(r.bests.longestStreakEndedOn)}` : ""}${r.streak.days > 0 && r.streak.days === r.bests.longestStreak ? " (that is now!)" : ""}`}
            label={`Longest streak: ${r.bests.longestStreak} days`}
          />
          {r.bests.bestWeek ? (
            <ListItem
              leading={<Text variant="title">🛒</Text>}
              title="Best grocery week"
              subtitle={`${formatDate(r.bests.bestWeek.start)} to ${formatDate(r.bests.bestWeek.end)}. This week so far: ${formatMoney(r.bests.thisWeekCents)}${r.bests.thisWeekCents < r.bests.bestWeek.spentCents ? " (on track to beat it)" : ""}`}
              trailing={<Money cents={r.bests.bestWeek.spentCents} variant="bodyStrong" tone="plain" />}
              label={`Best grocery week: ${formatMoney(r.bests.bestWeek.spentCents)}`}
            />
          ) : (
            <ListItem leading={<Text variant="title">🛒</Text>} title="No best grocery week yet" subtitle="It shows up after the first full week (Monday to Sunday) of bookings." />
          )}
        </Group>
      </Section>

      <Section title="Badges">
        <Group>
          {r.badges.map((b) => (
            <ListItem
              key={b.id}
              leading={<BadgeIcon badge={b} />}
              title={b.title}
              subtitle={b.rule}
              trailing={b.earned ? <Badge tone="success" icon="check" label={b.earnedOn ? formatDate(b.earnedOn) : "Earned"} /> : undefined}
              label={`${b.title}: ${b.earned ? "earned" : "not yet"}. ${b.rule}`}
            />
          ))}
        </Group>
      </Section>

      <Section title="Savings goal" card>
        <Text variant="caption" tone="muted">How much to put aside per budget period. Transfers booked in the category Savings count towards it. The goal is stored on this device only.</Text>
        {data.savingsGoal > 0 ? (
          <Box gap="sm">
            <Row gap="xs" align="baseline" wrap>
              <Money cents={saved} variant="heading" tone={saved >= data.savingsGoal ? "good" : "plain"} />
              <Text variant="label" tone="muted">{`of ${formatMoney(data.savingsGoal)} this period`}</Text>
            </Row>
            <Meter value={saved / data.savingsGoal} tone={saved >= data.savingsGoal ? "success" : "accent"} label="Savings goal progress" />
          </Box>
        ) : null}
        <TextField label="Goal per period (€)" value={goalText} onChangeText={setGoalText} keyboardType="decimal-pad" placeholder={data.savingsGoal > 0 ? String(data.savingsGoal / 100).replace(".", ",") : "e.g. 150"} />
        {goalMessage ? <Note>{goalMessage}</Note> : null}
        <Button label="Save goal" onPress={() => void saveGoal()} />
      </Section>

      <Button variant="outline" icon="home-variant-outline" label="Back to Today" onPress={() => router.push("/")} />
    </Page>
  );
}
