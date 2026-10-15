import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text as RNText, View } from "react-native";

import { ForecastCard } from "@/components/ForecastCard";
import { Mascot } from "@/components/Mascot";
import { SafeToSpendCard } from "@/components/SafeToSpendCard";
import { StoresLink } from "@/components/StoresLink";
import { TrophiesCard } from "@/components/TrophiesCard";
import { WatchdogCard } from "@/components/Watchdog";
import { EmptyState } from "@/components/EmptyState";
import { ChunkyButton } from "@/components/kit";
import { Money } from "@/components/Money";
import { StatusPill } from "@/components/rows";
import { SkeletonHero, SkeletonList } from "@/components/Skeleton";
import { Bar, Body, Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import type { Forecast, SafeToSpend } from "@/api/client";
import { useApi } from "@/api/config";
import { formatMoney } from "@/format";
import { computeRewards, coachMessage, dailyAllowanceOn, freshBadges, level, moodFor, quests, spentOn, xp, type Progress, type Quest } from "@/game";
import { useScreenData } from "@/hooks";
import { MONTH_NAMES, localIsoDate } from "@/period";
import { getSavingsGoal } from "@/savingsGoal";
import { getSecret, setSecret } from "@/api/storage";
import { celebrate } from "@/native/haptics";
import { space, typography, usePalette } from "@/theme";

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

function Pill({ icon, text, color, bg, label }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; text: string; color: string; bg: string; label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, borderRadius: 999, paddingHorizontal: space.md, minHeight: 32, backgroundColor: bg }}
    >
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <RNText style={{ color, fontSize: 14, lineHeight: 20, fontWeight: "800" }}>{text}</RNText>
    </View>
  );
}

function QuestRow({ quest, onGo }: { quest: Quest; onGo: () => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, minHeight: 56 }} accessibilityLabel={`${quest.title}${quest.done ? ", done" : ""}`}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: quest.done ? p.fill : "transparent",
          borderWidth: quest.done ? 0 : 2,
          borderColor: p.border,
        }}
      >
        {quest.done ? <MaterialCommunityIcons name="check-bold" size={18} color="#ffffff" /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={[typography.bodyStrong, { color: p.text, textDecorationLine: quest.done ? "line-through" : "none", opacity: quest.done ? 0.6 : 1 }]}>
          {quest.title}
        </RNText>
        <RNText style={[typography.caption, { color: p.muted }]}>{quest.hint}</RNText>
      </View>
      {quest.done ? null : <ChunkyButton compact label="Go" onPress={onGo} />}
    </View>
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
  const p = usePalette();
  const { toast } = useToast();
  const [celebrating, setCelebrating] = useState(false);
  const { data, error, busy, reload } = useScreenData<TodayData>(async (a) => {
    const [txs, envelopes, basket, prices, receipts, safe, forecast, savingsGoal] = await Promise.all([
      a.transactions(),
      a.envelopes(),
      a.basket(),
      a.prices(),
      a.receipts(),
      // the rest of the screen still works if this one fails (e.g. an older server)
      a.safeToSpend(localIsoDate()).catch(() => null),
      a.forecast(localIsoDate()).catch(() => null),
      getSavingsGoal(),
    ]);
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
      toast.show({
        variant: "success",
        label: `Quest complete! +${fresh.length * 10} XP 🎉`,
        description: fresh.map((q) => q.title).join(", "),
      });
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
      toast.show({
        variant: "success",
        label: fresh.length === 1 ? "New badge! 🏅" : `${fresh.length} new badges! 🏅`,
        description: fresh.map((b) => `${b.icon} ${b.title}`).join(", "),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const over = allowance > 0 && spentToday > allowance;
  const barColor = over ? p.bad : spentToday > allowance * 0.8 ? p.orange : p.fill;
  const goalLeft = Math.max(0, allowance - spentToday);

  return (
    <Screen>
      <Title
        subtitle={longDate(today)}
        right={
          data ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Pill icon="fire" text={`${days}`} color={p.warn} bg={p.warnSoft} label={`Streak: ${days} days`} />
              {rewards ? (
                <Pill
                  icon="snowflake"
                  text={`${rewards.streak.freezes}`}
                  color={p.blue}
                  bg={p.blueSoft}
                  label={`${rewards.streak.freezes} streak freeze${rewards.streak.freezes === 1 ? "" : "s"}`}
                />
              ) : null}
            </View>
          ) : null
        }
      >
        Today
      </Title>
      {!api ? (
        <NeedsSetup />
      ) : !data ? (
        error ? (
          <EmptyState title="Could not load your numbers" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} />
        ) : (
          <View style={{ gap: space.md }}>
            <SkeletonHero />
            <SkeletonList rows={2} />
          </View>
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} tintColor={p.accent} />}
        >
          <SafeToSpendCard data={data.safe} />

          <Card>
            <RNText style={[typography.overline, { color: p.muted }]}>Today's grocery goal</RNText>
            {allowance > 0 ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: space.xs, flexWrap: "wrap" }}>
                  <Money cents={goalLeft} variant="heading" tone={over ? "bad" : "plain"} style={{ fontSize: 26, lineHeight: 32 }} />
                  <RNText style={[typography.label, { color: p.muted }]}>left</RNText>
                </View>
                <Bar
                  progress={spentToday / allowance}
                  color={barColor}
                  height={14}
                  marginTop={space.sm}
                  accessibilityLabel={`${Math.round((spentToday / allowance) * 100)} percent of today's grocery goal spent`}
                />
                <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>
                  {formatMoney(spentToday)} spent of {formatMoney(allowance)} a day
                </RNText>
              </>
            ) : (
              <>
                <Body muted>Set a grocery limit and it becomes a daily goal here.</Body>
                <View style={{ marginTop: space.md }}>
                  <ChunkyButton label="Set a limit" onPress={() => router.push("/budget")} />
                </View>
              </>
            )}
          </Card>

          <ForecastCard data={data.forecast} />

          <WatchdogCard />

          <StoresLink />

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
              <View style={{ flexShrink: 1 }}>
                <RNText accessibilityRole="header" style={[typography.heading, { color: p.text }]}>Level {lvl.level}</RNText>
                <RNText style={[typography.caption, { color: p.muted }]}>{lvl.title} · {lvl.into} / {lvl.size} XP to level {lvl.level + 1}</RNText>
              </View>
              <StatusPill tone="gold" icon="lightning-bolt" label={`${points} XP`} accessibilityLabel={`${points} experience points`} />
            </View>
            <Bar progress={lvl.into / lvl.size} color={p.gold} marginTop={space.sm} accessibilityLabel={`${lvl.into} of ${lvl.size} experience points to level ${lvl.level + 1}`} />
            <View style={{ height: 1, backgroundColor: p.border, marginVertical: space.md }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
              <RNText style={[typography.bodyStrong, { color: p.text }]}>Quests</RNText>
              <StatusPill tone="accent" label={`${doneCount} / ${list.length}`} accessibilityLabel={`${doneCount} of ${list.length} quests done`} />
            </View>
            <Bar progress={doneCount / Math.max(1, list.length)} marginTop={space.md} accessibilityLabel={`${doneCount} of ${list.length} quests done`} />
            <View style={{ marginTop: space.sm }}>
              {list.map((q) => (
                <QuestRow key={q.id} quest={q} onGo={() => router.push(q.route)} />
              ))}
            </View>
          </Card>

          {rewards ? <TrophiesCard rewards={rewards} /> : null}

          <Mascot
            mood={moodFor({ streakDays: days, allowanceCents: allowance, spentTodayCents: spentToday, celebrating, freezeUsedToday: rewards?.streak.frozenToday })}
            message={coachMessage({
              progress: data.progress,
              streakDays: days,
              allowanceCents: allowance,
              spentTodayCents: spentToday,
              freezeUsedToday: rewards?.streak.frozenToday,
            })}
          />
        </ScrollView>
      )}
    </Screen>
  );
}
