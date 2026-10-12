import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text as RNText, View } from "react-native";

import type { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { Mascot } from "@/components/Mascot";
import { BadgeIcon, FreezeRow } from "@/components/TrophiesCard";
import { ChunkyButton, HelperText, TextInput } from "@/components/kit";
import { Bar, Body, Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { formatCents, formatDate, parseEuroInput } from "@/format";
import { FREEZE_EVERY, MAX_FREEZES, computeRewards, savedThisPeriod, trophyMessage, trophyMood } from "@/game";
import { useScreenData } from "@/hooks";
import { localIsoDate } from "@/period";
import { getSavingsGoal, setSavingsGoal } from "@/savingsGoal";
import { usePalette } from "@/theme";

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
  return <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>{children}</RNText>;
}

/** Streak freezes, badges, personal bests and the savings goal. Everything is derived from the bookings. */
export default function Trophies() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const p = usePalette();
  const { data, error, reload } = useScreenData(load);
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
      setGoalMessage(cents === 0 ? "Savings goal removed." : `Savings goal set to ${formatCents(cents)} per budget period.`);
      setGoalText("");
      await reload();
    } catch {
      setGoalMessage("Could not save the goal on this device.");
    }
  }

  return (
    <Screen>
      <Title>Trophies</Title>
      {!api ? (
        <NeedsSetup />
      ) : !data || !r ? (
        error ? <Body muted>{error}</Body> : <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <Mascot mood={trophyMood(r, false)} message={trophyMessage(r)} />

          <Card>
            <Label>STREAK FREEZES</Label>
            <View style={{ marginTop: 8 }}>
              <FreezeRow streak={r.streak} />
            </View>
            <RNText style={{ color: p.muted, fontSize: 13, marginTop: 8 }}>
              Every {FREEZE_EVERY}th day in a row inside your daily grocery goal earns a freeze (you can keep {MAX_FREEZES}). On a day you go over, a freeze is
              used automatically and your streak stays alive.
              {r.streak.usedOn.length > 0 ? ` Used ${r.streak.usedOn.length} time${r.streak.usedOn.length === 1 ? "" : "s"} so far.` : ""}
            </RNText>
            {data.groceryLimit <= 0 ? <HelperText type="info">Set a grocery limit to start a streak.</HelperText> : null}
          </Card>

          <Card>
            <Label>PERSONAL BESTS</Label>
            <View style={{ marginTop: 8, gap: 10 }}>
              <View accessibilityLabel={`Longest streak: ${r.bests.longestStreak} days`}>
                <RNText style={{ color: p.text, fontSize: 22, fontWeight: "800" }}>
                  🔥 {r.bests.longestStreak} {r.bests.longestStreak === 1 ? "day" : "days"}
                </RNText>
                <RNText style={{ color: p.muted, fontSize: 13 }}>
                  Longest streak{r.bests.longestStreakEndedOn ? `, ended ${formatDate(r.bests.longestStreakEndedOn)}` : ""}
                  {r.streak.days > 0 && r.streak.days === r.bests.longestStreak ? " (that is now!)" : ""}
                </RNText>
              </View>
              <View accessibilityLabel={r.bests.bestWeek ? `Best grocery week: ${formatCents(r.bests.bestWeek.spentCents)}` : "No best grocery week yet"}>
                {r.bests.bestWeek ? (
                  <>
                    <RNText style={{ color: p.text, fontSize: 22, fontWeight: "800" }}>🛒 {formatCents(r.bests.bestWeek.spentCents)}</RNText>
                    <RNText style={{ color: p.muted, fontSize: 13 }}>
                      Best grocery week, {formatDate(r.bests.bestWeek.start)} to {formatDate(r.bests.bestWeek.end)}. This week so far:{" "}
                      {formatCents(r.bests.thisWeekCents)}
                      {r.bests.thisWeekCents < r.bests.bestWeek.spentCents ? " (on track to beat it)" : ""}
                    </RNText>
                  </>
                ) : (
                  <RNText style={{ color: p.muted, fontSize: 13 }}>
                    Your best grocery week shows up after the first full week (Monday to Sunday) of bookings.
                  </RNText>
                )}
              </View>
            </View>
          </Card>

          <Card>
            <Label>BADGES</Label>
            <View style={{ marginTop: 6 }}>
              {r.badges.map((b) => (
                <View
                  key={b.id}
                  accessibilityLabel={`${b.title}: ${b.earned ? "earned" : "not yet"}. ${b.rule}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}
                >
                  <BadgeIcon badge={b} size={48} />
                  <View style={{ flex: 1 }}>
                    <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800", opacity: b.earned ? 1 : 0.7 }}>{b.title}</RNText>
                    <RNText style={{ color: p.muted, fontSize: 13 }}>{b.rule}</RNText>
                    {b.earned && b.earnedOn ? <RNText style={{ color: p.good, fontSize: 12, fontWeight: "700" }}>Earned {formatDate(b.earnedOn)}</RNText> : null}
                    {b.earned && !b.earnedOn ? <RNText style={{ color: p.good, fontSize: 12, fontWeight: "700" }}>Earned</RNText> : null}
                  </View>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <Label>SAVINGS GOAL</Label>
            <RNText style={{ color: p.muted, fontSize: 13, marginTop: 6 }}>
              How much to put aside per budget period. Transfers booked in the category Savings count towards it. The goal is stored on this device only.
            </RNText>
            {data.savingsGoal > 0 ? (
              <>
                <RNText style={{ color: p.text, fontSize: 18, fontWeight: "800", marginTop: 8 }}>
                  {formatCents(saved)} of {formatCents(data.savingsGoal)} this period
                </RNText>
                <Bar progress={saved / data.savingsGoal} color={saved >= data.savingsGoal ? p.good : p.fill} />
              </>
            ) : null}
            <View style={{ marginTop: 12 }}>
              <TextInput
                label="Goal per period (€)"
                value={goalText}
                onChangeText={setGoalText}
                keyboardType="decimal-pad"
                placeholder={data.savingsGoal > 0 ? String(data.savingsGoal / 100).replace(".", ",") : "e.g. 150"}
              />
            </View>
            {goalMessage ? <HelperText type="info">{goalMessage}</HelperText> : null}
            <View style={{ marginTop: 12 }}>
              <ChunkyButton compact label="Save goal" onPress={() => void saveGoal()} />
            </View>
          </Card>

          <ChunkyButton outline icon="home-variant-outline" label="Back to Today" onPress={() => router.push("/")} />
        </ScrollView>
      )}
    </Screen>
  );
}
