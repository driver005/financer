import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { ScrollView, Text as RNText, View } from "react-native";

import { Mascot } from "@/components/Mascot";
import { ChunkyButton } from "@/components/kit";
import { Bar, Body, Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { useApi } from "@/api/config";
import { formatCents } from "@/format";
import { coachMessage, dailyAllowance, level, moodFor, quests, spentOn, streak, xp, type Progress, type Quest } from "@/game";
import { useScreenData } from "@/hooks";
import { getSecret, setSecret } from "@/api/storage";
import { celebrate } from "@/native/haptics";
import { usePalette } from "@/theme";

const SEEN_KEY = "financer.quests.seen";
// Quests already celebrated since the app started. Module level (not per component) so a
// remount or two quick reloads cannot celebrate the same quest twice.
const celebrated = new Set<string>();

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Pill({ icon, text, color, label }: { icon: string; text: string; color: string; label: string }) {
  const p = usePalette();
  return (
    <View
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 2, borderColor: p.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: p.surface }}
    >
      <RNText style={{ fontSize: 16 }}>{icon}</RNText>
      <RNText style={{ color, fontSize: 15, fontWeight: "800" }}>{text}</RNText>
    </View>
  );
}

function QuestRow({ quest, onGo }: { quest: Quest; onGo: () => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }} accessibilityLabel={`${quest.title}${quest.done ? ", done" : ""}`}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: quest.done ? p.fill : "transparent",
          borderWidth: quest.done ? 0 : 2,
          borderColor: p.border,
        }}
      >
        {quest.done ? <MaterialCommunityIcons name="check-bold" size={18} color="#ffffff" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800", textDecorationLine: quest.done ? "line-through" : "none", opacity: quest.done ? 0.6 : 1 }}>
          {quest.title}
        </RNText>
        <RNText style={{ color: p.muted, fontSize: 13 }}>{quest.hint}</RNText>
      </View>
      {quest.done ? null : <ChunkyButton compact label="Go" onPress={onGo} />}
    </View>
  );
}

type TodayData = { progress: Progress; txs: Awaited<ReturnType<import("@/api/client").Api["transactions"]>>; groceryLimit: number };

export default function Today() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const p = usePalette();
  const { toast } = useToast();
  const [celebrating, setCelebrating] = useState(false);
  const { data, error } = useScreenData<TodayData>(async (a) => {
    const [txs, envelopes, basket, prices, receipts] = await Promise.all([
      a.transactions(),
      a.envelopes(),
      a.basket(),
      a.prices(),
      a.receipts(),
    ]);
    return {
      txs,
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

  const today = isoToday();
  const [y, m] = today.split("-").map(Number);
  const allowance = data ? dailyAllowance(data.groceryLimit, y, m) : 0;
  const spentToday = data ? spentOn(data.txs, today, "groceries") : 0;
  const days = data ? streak(data.txs, data.groceryLimit, today) : 0;
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

  if (!loaded) return <Screen><Loading /></Screen>;

  const over = allowance > 0 && spentToday > allowance;
  const barColor = over ? p.bad : spentToday > allowance * 0.8 ? p.orange : p.fill;

  return (
    <Screen>
      <Title>Today</Title>
      {!api ? (
        <NeedsSetup />
      ) : !data ? (
        error ? <Body muted>{error}</Body> : <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Pill icon="🔥" text={`${days}`} color={p.orange} label={`Streak: ${days} days`} />
            <Pill icon="⚡" text={`${points} XP`} color={p.gold} label={`${points} experience points`} />
            <Pill icon="🏅" text={`Lvl ${lvl.level} ${lvl.title}`} color={p.blue} label={`Level ${lvl.level}, ${lvl.title}`} />
          </View>

          <Mascot
            mood={moodFor({ streakDays: days, allowanceCents: allowance, spentTodayCents: spentToday, celebrating })}
            message={coachMessage({ progress: data.progress, streakDays: days, allowanceCents: allowance, spentTodayCents: spentToday })}
          />

          <Card>
            <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>NEXT LEVEL</RNText>
            <Bar progress={lvl.into / lvl.size} color={p.gold} />
            <RNText style={{ color: p.muted, fontSize: 13, marginTop: 6 }}>
              {lvl.into} / {lvl.size} XP to level {lvl.level + 1}
            </RNText>
          </Card>

          <Card>
            <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>TODAY'S GROCERY GOAL</RNText>
            {allowance > 0 ? (
              <>
                <RNText style={{ color: p.text, fontSize: 26, fontWeight: "800", marginTop: 4 }}>
                  {formatCents(Math.max(0, allowance - spentToday))} left
                </RNText>
                <Bar progress={spentToday / allowance} color={barColor} height={14} />
                <RNText style={{ color: p.muted, fontSize: 13, marginTop: 6 }}>
                  {formatCents(spentToday)} spent of {formatCents(allowance)} a day
                </RNText>
              </>
            ) : (
              <>
                <Body muted>Set a monthly grocery limit and it becomes a daily goal here.</Body>
                <View style={{ marginTop: 12 }}>
                  <ChunkyButton label="Set a limit" onPress={() => router.push("/budget")} />
                </View>
              </>
            )}
          </Card>

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <RNText style={{ color: p.text, fontSize: 18, fontWeight: "800" }}>Quests</RNText>
              <RNText style={{ color: p.muted, fontWeight: "800" }}>{doneCount} / {list.length}</RNText>
            </View>
            <Bar progress={doneCount / Math.max(1, list.length)} />
            <View style={{ marginTop: 6 }}>
              {list.map((q) => (
                <QuestRow key={q.id} quest={q} onGo={() => router.push(q.route)} />
              ))}
            </View>
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
