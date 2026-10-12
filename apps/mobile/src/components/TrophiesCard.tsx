import { useRouter } from "expo-router";
import { Text as RNText, View } from "react-native";

import { ChunkyButton } from "@/components/kit";
import { StatusPill } from "@/components/rows";
import { Card } from "@/components/ui";
import { formatMoney } from "@/format";
import { MAX_FREEZES, type Badge, type Rewards, type StreakState } from "@/game";
import { space, typography, usePalette } from "@/theme";

/** The streak freezes in stock: one snowflake per slot, dimmed when empty. */
export function FreezeRow({ streak }: { streak: StreakState }) {
  const p = usePalette();
  return (
    <View
      accessibilityLabel={`${streak.freezes} of ${MAX_FREEZES} streak freezes in stock`}
      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      {Array.from({ length: MAX_FREEZES }, (_, i) => (
        <RNText key={i} style={{ fontSize: 22, opacity: i < streak.freezes ? 1 : 0.25 }}>
          ❄️
        </RNText>
      ))}
      <RNText style={[typography.caption, { color: p.muted, marginLeft: space.xs, flexShrink: 1 }]}>
        {streak.freezes === 0 ? "No freeze in stock" : `${streak.freezes} streak freeze${streak.freezes === 1 ? "" : "s"} in stock`}
      </RNText>
    </View>
  );
}

/** A badge as a round icon: in colour when earned, dim and greyed out otherwise. */
export function BadgeIcon({ badge, size = 44 }: { badge: Badge; size?: number }) {
  const p = usePalette();
  return (
    <View
      accessibilityLabel={`${badge.title}${badge.earned ? ", earned" : ", not earned yet"}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: badge.earned ? p.gold : p.border,
        backgroundColor: badge.earned ? p.goldSoft : "transparent",
        opacity: badge.earned ? 1 : 0.4,
      }}
    >
      <RNText style={{ fontSize: size * 0.5 }}>{badge.icon}</RNText>
    </View>
  );
}

/** Summary on the Today tab with a link to the full Trophies screen. */
export function TrophiesCard({ rewards }: { rewards: Rewards }) {
  const p = usePalette();
  const router = useRouter();
  const earned = rewards.badges.filter((b) => b.earned).length;
  const { bests } = rewards;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
        <RNText accessibilityRole="header" style={[typography.heading, { color: p.text }]}>
          Trophies
        </RNText>
        <StatusPill tone="gold" icon="trophy-outline" label={`${earned} / ${rewards.badges.length}`} accessibilityLabel={`${earned} of ${rewards.badges.length} badges earned`} />
      </View>
      <View style={{ marginTop: space.md }}>
        <FreezeRow streak={rewards.streak} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
        {rewards.badges.map((b) => (
          <BadgeIcon key={b.id} badge={b} />
        ))}
      </View>
      <RNText style={[typography.caption, { color: p.muted, marginTop: space.md }]}>
        Longest streak: {bests.longestStreak} {bests.longestStreak === 1 ? "day" : "days"}
        {bests.bestWeek ? ` · Best grocery week: ${formatMoney(bests.bestWeek.spentCents)}` : ""}
      </RNText>
      <View style={{ marginTop: space.md }}>
        <ChunkyButton compact outline icon="trophy-outline" label="All trophies" onPress={() => router.push("/trophies")} />
      </View>
    </Card>
  );
}
