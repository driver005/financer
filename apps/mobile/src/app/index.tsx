import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Badge, Box, Button, Card, Divider, Icon, Mascot, Meter, Money, Row, Snackbar, Text, type Tone } from "@financer/ui";

import type { Forecast, SafeToSpend } from "@/api/client";
import { useApi } from "@/api/config";
import { getSecret, setSecret } from "@/api/storage";
import { ForecastCard } from "@/components/ForecastCard";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { StoresLink } from "@/components/StoresLink";
import { CategoryCard } from "@/components/today/CategoryCard";
import { OverviewTiles } from "@/components/today/OverviewTiles";
import { UpcomingCard } from "@/components/today/UpcomingCard";
import { TodayHero } from "@/components/today/TodayHero";
import { WeekCard } from "@/components/today/WeekCard";
import { TrophiesCard } from "@/components/TrophiesCard";
import { WatchdogCard } from "@/components/Watchdog";
import { formatMoney } from "@/format";
import { computeRewards, coachMessage, dailyAllowanceOn, freshBadges, level, moodFor, quests, spentOn, xp, type Progress, type Quest } from "@/game";
import { useScreenData } from "@/hooks";
import { celebrate } from "@/native/haptics";
import { MONTH_NAMES, budgetPeriod, localIsoDate } from "@/period";
import { getSavingsGoal } from "@/savingsGoal";

const SEEN_KEY = "financer.quests.seen";
// Quests already celebrated since the app started. Module level (not per component) so a
// remount or two quick reloads cannot celebrate the same quest twice.
const celebrated = new Set<string>();
const BADGES_SEEN_KEY = "financer.badges.seen";
// The same guard for badges (see `freshBadges`).
const celebratedBadges = new Set<string>();

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `2026-10-12` -> `Monday, 12 October`. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTH_NAMES[m - 1]}`;
}

function QuestRow({ quest, onGo }: { quest: Quest; onGo: () => void }) {
  return (
    <Row gap="md" py="sm" touch accessible accessibilityLabel={`${quest.title}${quest.done ? ", done" : ""}`}>
      <Box dim="icon-lg" radius="full" align="center" justify="center" bg={quest.done ? "accent-solid" : "sunken"}>
        {quest.done ? <Icon name="check-bold" size="sm" tone="on-accent-solid" /> : null}
      </Box>
      <Box grow>
        <Text variant="bodyStrong" tone={quest.done ? "subtle" : "default"} strike={quest.done}>{quest.title}</Text>
        <Text variant="caption" tone="muted">{quest.hint}</Text>
      </Box>
      {quest.done ? null : <Button size="sm" label="Go" onPress={onGo} />}
    </Row>
  );
}

type TodayData = {
  progress: Progress;
  txs: Awaited<ReturnType<import("@/api/client").Api["transactions"]>>;
  groceryLimit: number;
  safe: SafeToSpend | null;
  forecast: Forecast | null;
  savingsGoal: number;
};

export default function Today() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const [celebrating, setCelebrating] = useState(false);
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const [allQuests, setAllQuests] = useState(false);
  const { data, error, busy, reload } = useScreenData<TodayData>(async (a) => {
    const [txs, budget, basket, prices, receipts, forecast, savingsGoal] = await Promise.all([
      a.transactions(),
      a.budget("current", localIsoDate()),
      a.basket(),
      a.prices(),
      a.receipts(),
      // the rest of the screen still works if this one fails (e.g. an older server)
      a.forecast(localIsoDate()).catch(() => null),
      getSavingsGoal(),
    ]);
    const envelopes = budget.envelopes;
    const safe = budget.safe_to_spend ?? null;
    return {
      txs,
      safe,
      forecast,
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
  });

  const today = localIsoDate();
  // the budget period (payday to payday) decides how many days the limit is spread over
  const payday = data?.safe?.payday ?? 1;
  const allowance = data ? dailyAllowanceOn(data.groceryLimit, today, payday) : 0;
  const spentToday = data ? spentOn(data.txs, today, "groceries") : 0;
  // streak with freezes, badges and bests, all replayed from the bookings (see game.ts)
  const rewards = data
    ? computeRewards({ txs: data.txs, groceryLimit: data.groceryLimit, savingsGoal: data.savingsGoal, today, payday, progress: data.progress })
    : null;
  const days = rewards?.streak.days ?? 0;
  const list = data ? quests(data.progress) : [];
  const doneCount = list.filter((q) => q.done).length;
  const points = xp(doneCount, days);
  const lvl = level(points);

  // Celebrate quests completed since the last visit.
  useEffect(() => {
    if (!data) return;
    const doneIds = list.filter((q) => q.done).map((q) => q.id);
    const unclaimed = list.filter((q) => q.done && !celebrated.has(q.id));
    if (unclaimed.length === 0) return;
    unclaimed.forEach((q) => celebrated.add(q.id));
    void (async () => {
      let seen: string[] = [];
      try {
        seen = JSON.parse((await getSecret(SEEN_KEY)) ?? "[]");
      } catch {
        seen = [];
      }
      const fresh = unclaimed.filter((q) => !seen.includes(q.id));
      if (fresh.length === 0) return;
      await setSecret(SEEN_KEY, JSON.stringify(doneIds));
      celebrate();
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 4000);
      setNote({ title: `Quest complete! +${fresh.length * 10} XP 🎉`, text: fresh.map((q) => q.title).join(", ") });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Celebrate badges earned since the last visit, once per badge.
  useEffect(() => {
    if (!rewards) return;
    const earnedIds = rewards.badges.filter((b) => b.earned).map((b) => b.id);
    const unclaimed = freshBadges(rewards.badges, [], celebratedBadges);
    if (unclaimed.length === 0) return;
    unclaimed.forEach((b) => celebratedBadges.add(b.id));
    void (async () => {
      let seen: string[] = [];
      try {
        seen = JSON.parse((await getSecret(BADGES_SEEN_KEY)) ?? "[]");
      } catch {
        seen = [];
      }
      const fresh = unclaimed.filter((b) => !seen.includes(b.id));
      if (fresh.length === 0) return;
      await setSecret(BADGES_SEEN_KEY, JSON.stringify(earnedIds));
      celebrate();
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 4000);
      setNote({ title: fresh.length === 1 ? "New badge! 🏅" : `${fresh.length} new badges! 🏅`, text: fresh.map((b) => `${b.icon} ${b.title}`).join(", ") });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!loaded) return <Page title="Today"><Loading /></Page>;
  if (!api) return <Page title="Today" subtitle={longDate(today)}><NeedsSetup /></Page>;

  const over = allowance > 0 && spentToday > allowance;
  const nearly = allowance > 0 && spentToday > allowance * 0.8;
  const goalLeft = Math.max(0, allowance - spentToday);
  const goalTone: Tone = over ? "danger" : nearly ? "warning" : "success";

  return (
    <Page
      title="Today"
      subtitle={longDate(today)}
      actions={
        data ? (
          <Row gap="sm">
            <Badge tone="warning" icon="fire" label={`${days}`} />
            {rewards ? <Badge tone="info" icon="snowflake" label={`${rewards.streak.freezes}`} /> : null}
          </Row>
        ) : null
      }
    >
      {!data ? (
        error ? (
          <Empty title="Could not load your numbers" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} />
        ) : (
          <Loading rows={4} />
        )
      ) : (
        <>
          <Snackbar visible={note !== null} onDismiss={() => setNote(null)} seconds={5}>{note ? `${note.title} ${note.text}` : ""}</Snackbar>
          <TodayHero safe={data.safe} forecast={data.forecast} txs={data.txs} today={today} />

          <UpcomingCard />

          <OverviewTiles safe={data.safe} txs={data.txs} today={today} />

          <WeekCard txs={data.txs} today={today} />

          <CategoryCard txs={data.txs} period={data.safe ? { start: data.safe.period_start, end: data.safe.period_end } : budgetPeriod(today, payday)} />

          <Card gap="md">
            <Text variant="label" tone="muted">Today's grocery goal</Text>
            {allowance > 0 ? (
              <>
                <Row justify="between" align="baseline" gap="sm" wrap>
                  <Row gap="sm" align="baseline">
                    <Money cents={goalLeft} variant="title" tone={over ? "bad" : "plain"} />
                    <Text variant="label" tone="muted">left</Text>
                  </Row>
                  <Text variant="caption" tone="muted">{`${formatMoney(spentToday)} of ${formatMoney(allowance)}`}</Text>
                </Row>
                <Meter value={spentToday / allowance} tone={goalTone} thickness="lg" label={`${Math.round((spentToday / allowance) * 100)} percent of today's grocery goal spent`} />
              </>
            ) : (
              <>
                <Text variant="body" tone="muted">Set a grocery limit and it becomes a daily goal here.</Text>
                <Button label="Set a limit" onPress={() => router.push("/budget")} />
              </>
            )}
          </Card>

          <ForecastCard data={data.forecast} />

          <WatchdogCard />

          <StoresLink />

          <Card gap="md">
            <Row justify="between" gap="md">
              <Box grow>
                <Text variant="heading" level={2}>{`Level ${lvl.level}`}</Text>
                <Text variant="caption" tone="muted">{`${lvl.title} · ${lvl.into} / ${lvl.size} XP to level ${lvl.level + 1}`}</Text>
              </Box>
              <Badge tone="warning" icon="lightning-bolt" label={`${points} XP`} />
            </Row>
            <Meter value={lvl.into / lvl.size} tone="warning" label={`${lvl.into} of ${lvl.size} experience points to level ${lvl.level + 1}`} />
            <Divider />
            <Row justify="between" gap="md">
              <Text variant="bodyStrong">Quests</Text>
              <Badge tone="accent" label={`${doneCount} / ${list.length}`} />
            </Row>
            <Meter value={doneCount / Math.max(1, list.length)} label={`${doneCount} of ${list.length} quests done`} />
            {/* the next open quest is enough at a glance; the rest is one tap away */}
            {(allQuests ? list : list.filter((q) => !q.done).slice(0, 1)).map((q) => (
              <QuestRow key={q.id} quest={q} onGo={() => router.push(q.route)} />
            ))}
            {list.length > 1 ? <Row><Button size="sm" variant="ghost" icon={allQuests ? "chevron-up" : "chevron-down"} label={allQuests ? "Show fewer" : `All ${list.length} quests`} onPress={() => setAllQuests((v) => !v)} /></Row> : null}
          </Card>

          {rewards ? <TrophiesCard rewards={rewards} /> : null}

          <Mascot
            mood={moodFor({ streakDays: days, allowanceCents: allowance, spentTodayCents: spentToday, celebrating, freezeUsedToday: rewards?.streak.frozenToday })}
            message={coachMessage({ progress: data.progress, streakDays: days, allowanceCents: allowance, spentTodayCents: spentToday, freezeUsedToday: rewards?.streak.frozenToday })}
          />
        </>
      )}
    </Page>
  );
}
