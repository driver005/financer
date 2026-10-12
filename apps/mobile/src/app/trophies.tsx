import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text as RNText, View } from "react-native";

import type { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { Mascot } from "@/components/Mascot";
import { BadgeIcon, FreezeRow } from "@/components/TrophiesCard";
import { EmptyState } from "@/components/EmptyState";
import { ChunkyButton, HelperText, TextInput } from "@/components/kit";
import { Money } from "@/components/Money";
import { Ring } from "@/components/Ring";
import { ListGroup, ListRow, SectionHeader, StatusPill } from "@/components/rows";
import { SkeletonHero, SkeletonList } from "@/components/Skeleton";
import { Bar, Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { formatDate, formatMoney, parseEuroInput } from "@/format";
import { FREEZE_EVERY, MAX_FREEZES, computeRewards, savedThisPeriod, trophyMessage, trophyMood } from "@/game";
import { useScreenData } from "@/hooks";
import { localIsoDate } from "@/period";
import { getSavingsGoal, setSavingsGoal } from "@/savingsGoal";
import { space, typography, usePalette } from "@/theme";

async function load(a: Api) {
  const [txs, envelopes, basket, prices, receipts, safe, savingsGoal] = await Promise.all([
    a.transactions(),
    a.envelopes(),
    a.basket(),
    a.prices(),
    a.receipts(),
    a.safeToSpend(localIsoDate()).catch(() => null),
    getSavingsGoal(),
  ]);
  return {
    txs,
    payday: safe?.payday ?? 1,
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

function Label({ children }: { children: string }) {
  const p = usePalette();
  return <RNText style={[typography.overline, { color: p.muted, textTransform: "uppercase" }]}>{children}</RNText>;
}

/** Streak freezes, badges, personal bests and the savings goal. Everything is derived from the bookings. */
export default function Trophies() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const p = usePalette();
  const { data, error, busy, reload } = useScreenData(load);
  const [goalText, setGoalText] = useState("");
  const [goalMessage, setGoalMessage] = useState<string | null>(null);

  if (!loaded) return <Screen><Loading /></Screen>;

  const today = localIsoDate();
  const r = data
    ? computeRewards({
        txs: data.txs,
        groceryLimit: data.groceryLimit,
        savingsGoal: data.savingsGoal,
        today,
        payday: data.payday,
        progress: data.progress,
      })
    : null;
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

  return (
    <Screen>
      <Title subtitle={r ? `${earned} of ${r.badges.length} badges earned` : undefined}>Trophies</Title>
      {!api ? (
        <NeedsSetup />
      ) : !data || !r ? (
        error ? (
          <EmptyState title="Could not load your trophies" message={error} mood="worried" actionLabel="Try again" actionIcon="refresh" onAction={() => void reload()} />
        ) : (
          <View style={{ gap: space.md }}>
            <SkeletonHero />
            <SkeletonList rows={3} />
          </View>
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} tintColor={p.accent} />}
        >
          <Card style={{ alignItems: "center", paddingVertical: space.xl }}>
            <Label>Badges earned</Label>
            <View style={{ marginTop: space.md }}>
              <Ring
                size={168}
                stroke={14}
                progress={r.badges.length > 0 ? earned / r.badges.length : 0}
                color={p.gold}
                track={p.goldSoft}
                accessibilityLabel={`${earned} of ${r.badges.length} badges earned`}
              >
                <View style={{ alignItems: "center" }}>
                  <RNText style={[typography.display, { color: p.text, fontVariant: ["tabular-nums"] }]}>{earned}</RNText>
                  <RNText style={[typography.label, { color: p.muted }]}>of {r.badges.length}</RNText>
                </View>
              </Ring>
            </View>
            <View style={{ alignSelf: "stretch", marginTop: space.lg }}>
              <Mascot mood={trophyMood(r, false)} message={trophyMessage(r)} />
            </View>
          </Card>

          <Card>
            <Label>Streak freezes</Label>
            <View style={{ marginTop: space.md }}>
              <FreezeRow streak={r.streak} />
            </View>
            <RNText style={[typography.caption, { color: p.muted, marginTop: space.md }]}>
              Every {FREEZE_EVERY}th day in a row inside your daily grocery goal earns a freeze (you can keep {MAX_FREEZES}). On a day you go over, a freeze is
              used automatically and your streak stays alive.
              {r.streak.usedOn.length > 0 ? ` Used ${r.streak.usedOn.length} time${r.streak.usedOn.length === 1 ? "" : "s"} so far.` : ""}
            </RNText>
            {data.groceryLimit <= 0 ? <HelperText type="info">Set a grocery limit to start a streak.</HelperText> : null}
          </Card>

          <SectionHeader title="Personal bests" />
          <ListGroup>
            <ListRow
              leading={<IconEmoji emoji="🔥" />}
              title={`${r.bests.longestStreak} ${r.bests.longestStreak === 1 ? "day" : "days"}`}
              subtitle={`Longest streak${r.bests.longestStreakEndedOn ? `, ended ${formatDate(r.bests.longestStreakEndedOn)}` : ""}${
                r.streak.days > 0 && r.streak.days === r.bests.longestStreak ? " (that is now!)" : ""
              }`}
              accessibilityLabel={`Longest streak: ${r.bests.longestStreak} days`}
            />
            {r.bests.bestWeek ? (
              <ListRow
                leading={<IconEmoji emoji="🛒" />}
                title="Best grocery week"
                subtitleLines={4}
                subtitle={`${formatDate(r.bests.bestWeek.start)} to ${formatDate(r.bests.bestWeek.end)}. This week so far: ${formatMoney(r.bests.thisWeekCents)}${
                  r.bests.thisWeekCents < r.bests.bestWeek.spentCents ? " (on track to beat it)" : ""
                }`}
                value={<Money cents={r.bests.bestWeek.spentCents} variant="bodyStrong" tone="plain" />}
                accessibilityLabel={`Best grocery week: ${formatMoney(r.bests.bestWeek.spentCents)}`}
              />
            ) : (
              <ListRow
                leading={<IconEmoji emoji="🛒" />}
                title="No best grocery week yet"
                subtitleLines={4}
                subtitle="It shows up after the first full week (Monday to Sunday) of bookings."
                accessibilityLabel="No best grocery week yet"
              />
            )}
          </ListGroup>

          <SectionHeader title="Badges" />
          <ListGroup>
            {r.badges.map((b) => (
              <ListRow
                key={b.id}
                leading={<BadgeIcon badge={b} size={44} />}
                title={b.title}
                subtitle={b.rule}
                subtitleLines={8}
                value={b.earned ? <StatusPill tone="good" icon="check" label={b.earnedOn ? formatDate(b.earnedOn) : "Earned"} accessibilityLabel={b.earnedOn ? `Earned ${formatDate(b.earnedOn)}` : "Earned"} /> : undefined}
                accessibilityLabel={`${b.title}: ${b.earned ? "earned" : "not yet"}. ${b.rule}`}
              />
            ))}
          </ListGroup>

          <Card>
            <Label>Savings goal</Label>
            <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>
              How much to put aside per budget period. Transfers booked in the category Savings count towards it. The goal is stored on this device only.
            </RNText>
            {data.savingsGoal > 0 ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: space.xs, marginTop: space.md }}>
                  <Money cents={saved} variant="heading" tone={saved >= data.savingsGoal ? "good" : "plain"} />
                  <RNText style={[typography.label, { color: p.muted }]}>of {formatMoney(data.savingsGoal)} this period</RNText>
                </View>
                <Bar progress={saved / data.savingsGoal} color={saved >= data.savingsGoal ? p.good : p.fill} accessibilityLabel="Savings goal progress" />
              </>
            ) : null}
            <View style={{ marginTop: space.lg }}>
              <TextInput
                label="Goal per period (€)"
                value={goalText}
                onChangeText={setGoalText}
                keyboardType="decimal-pad"
                placeholder={data.savingsGoal > 0 ? String(data.savingsGoal / 100).replace(".", ",") : "e.g. 150"}
              />
            </View>
            {goalMessage ? <HelperText type="info">{goalMessage}</HelperText> : null}
            <View style={{ marginTop: space.lg }}>
              <ChunkyButton compact label="Save goal" onPress={() => void saveGoal()} />
            </View>
          </Card>

          <ChunkyButton outline icon="home-variant-outline" label="Back to Today" onPress={() => router.push("/")} />
        </ScrollView>
      )}
    </Screen>
  );
}

/** A big emoji in a soft round badge, for rows that have no category icon. */
function IconEmoji({ emoji }: { emoji: string }) {
  const p = usePalette();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}
    >
      <RNText style={{ fontSize: 22 }}>{emoji}</RNText>
    </View>
  );
}
