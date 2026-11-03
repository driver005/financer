import { useRouter } from "expo-router";
import { Badge, Box, Button, Card, Row, Text } from "@financer/ui";

import { formatMoney } from "@/format";
import { MAX_FREEZES, type Badge as GameBadge, type Rewards, type StreakState } from "@/game";

/** The streak freezes in stock: one snowflake per slot, dimmed when empty. */
export function FreezeRow({ streak }: { streak: StreakState }) {
  return (
    <Row gap="sm" accessible accessibilityLabel={`${streak.freezes} of ${MAX_FREEZES} streak freezes in stock`}>
      <Row gap="xs">
        {Array.from({ length: MAX_FREEZES }, (_, i) => (
          <Box key={i}>
            <Text variant="title" tone={i < streak.freezes ? "default" : "subtle"}>{"❄️"}</Text>
          </Box>
        ))}
      </Row>
      <Box grow><Text variant="caption" tone="muted">{streak.freezes === 0 ? "No freeze in stock" : `${streak.freezes} streak freeze${streak.freezes === 1 ? "" : "s"} in stock`}</Text></Box>
    </Row>
  );
}

/** A badge as a round icon: in colour when earned, dim and greyed out otherwise. */
export function BadgeIcon({ badge }: { badge: GameBadge }) {
  return (
    <Box
      dim="avatar-md"
      radius="full"
      align="center"
      justify="center"
      bg={badge.earned ? "warning-soft" : "sunken"}
      accessible
      accessibilityLabel={`${badge.title}${badge.earned ? ", earned" : ", not earned yet"}`}
    >
      <Text variant="title" tone={badge.earned ? "default" : "subtle"}>{badge.icon}</Text>
    </Box>
  );
}

/** Summary on the Today tab with a link to the full Trophies screen. */
export function TrophiesCard({ rewards }: { rewards: Rewards }) {
  const router = useRouter();
  const earned = rewards.badges.filter((b) => b.earned).length;
  const { bests } = rewards;
  return (
    <Card gap="md">
      <Row justify="between" gap="md">
        <Text variant="heading" level={2}>Trophies</Text>
        <Badge tone="warning" icon="trophy-outline" label={`${earned} / ${rewards.badges.length}`} />
      </Row>
      <FreezeRow streak={rewards.streak} />
      <Row gap="sm" wrap>
        {rewards.badges.map((b) => (
          <BadgeIcon key={b.id} badge={b} />
        ))}
      </Row>
      <Text variant="caption" tone="muted">
        {`Longest streak: ${bests.longestStreak} ${bests.longestStreak === 1 ? "day" : "days"}${bests.bestWeek ? ` · Best grocery week: ${formatMoney(bests.bestWeek.spentCents)}` : ""}`}
      </Text>
      <Row><Button size="sm" variant="outline" icon="trophy-outline" label="All trophies" onPress={() => router.push("/trophies")} /></Row>
    </Card>
  );
}
