import { useRouter } from "expo-router";
import { Text as RNText, View } from "react-native";

import { useApi } from "@/api/config";
import { ListGroup, ListRow, SectionHeader } from "@/components/rows";
import { useScreenData } from "@/hooks";
import { radius, space, usePalette } from "@/theme";
import { nextChargeText } from "@/watchdog";

/** Small outlined label (price hike, duplicate, severity ...). */
export function Badge({ text, tone = "muted" }: { text: string; tone?: "bad" | "warn" | "good" | "muted" }) {
  const p = usePalette();
  const edge = { bad: p.bad, warn: p.warn, good: p.good, muted: p.border }[tone];
  return (
    <View style={{ borderWidth: 1, borderColor: edge, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 1, alignSelf: "flex-start" }}>
      <RNText style={{ color: tone === "bad" ? p.bad : p.text, fontSize: 12, lineHeight: 16, fontWeight: "800" }}>{text}</RNText>
    </View>
  );
}

/** Round red counter, e.g. the number of unread alerts. */
export function CountBubble({ count, label }: { count: number; label: string }) {
  const p = usePalette();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={label}
      style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: p.bad }}
    >
      <RNText style={{ color: p.onBad, fontSize: 13, fontWeight: "800" }}>{count > 99 ? "99+" : count}</RNText>
    </View>
  );
}

/**
 * Entry point on the Today tab: unread alert count and the next subscription charge as two rows
 * with links to the Alerts and Subscriptions screens. Renders nothing while loading or when the
 * server cannot be reached (the rest of Today already says so).
 */
export function WatchdogCard() {
  const { api } = useApi();
  const router = useRouter();
  const { data } = useScreenData(async (a) => {
    const [alerts, subs] = await Promise.all([a.alerts(), a.subscriptions(14)]);
    return { unread: alerts.unread_count, subs };
  });
  if (!api || !data) return null;

  const next = nextChargeText(data.subs.upcoming, data.subs.as_of, 14);
  const hikes = data.subs.price_hikes.length;
  const title = data.unread > 0 ? `${data.unread} unread alert${data.unread === 1 ? "" : "s"}` : "No alerts";
  return (
    <>
      <SectionHeader title="Watchdog" />
      <ListGroup>
        <ListRow
          icon="shield-alert-outline"
          iconTone={data.unread > 0 ? "bad" : "good"}
          title={title}
          subtitle={hikes > 0 ? `${hikes} price increase${hikes === 1 ? "" : "s"}` : "Nothing unusual in your bookings"}
          value={<CountBubble count={data.unread} label={`${data.unread} unread alerts`} />}
          onPress={() => router.push("/alerts")}
          accessibilityLabel={`${title}. Open alerts`}
        />
        <ListRow
          icon="calendar-sync-outline"
          iconTone="blue"
          title={next ?? "No charges due soon"}
          subtitle="Subscriptions"
          onPress={() => router.push("/subscriptions")}
          accessibilityLabel={`${next ?? "No charges due soon"}. Open subscriptions`}
        />
      </ListGroup>
    </>
  );
}
