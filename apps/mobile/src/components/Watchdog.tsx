import { useRouter } from "expo-router";
import { Pressable, Text as RNText, View } from "react-native";

import { useApi } from "@/api/config";
import { ChunkyButton } from "@/components/kit";
import { Card } from "@/components/ui";
import { useScreenData } from "@/hooks";
import { useInk } from "@/components/settings/SettingsKit";
import { usePalette } from "@/theme";
import { nextChargeText } from "@/watchdog";

/** Small outlined label (price hike, duplicate, severity ...). */
export function Badge({ text, tone = "muted" }: { text: string; tone?: "bad" | "warn" | "good" | "muted" }) {
  const p = usePalette();
  const ink = useInk();
  const edge = { bad: ink.danger, warn: p.orange, good: ink.success, muted: p.border }[tone];
  return (
    <View style={{ borderWidth: 2, borderColor: edge, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1, alignSelf: "flex-start" }}>
      <RNText style={{ color: tone === "bad" ? ink.danger : p.text, fontSize: 12, fontWeight: "800" }}>{text}</RNText>
    </View>
  );
}

/** Round red counter, e.g. the number of unread alerts. */
export function CountBubble({ count, label }: { count: number; label: string }) {
  const ink = useInk();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={label}
      style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: ink.dangerFace }}
    >
      <RNText style={{ color: ink.onDanger, fontSize: 13, fontWeight: "800" }}>{count > 99 ? "99+" : count}</RNText>
    </View>
  );
}

/**
 * Entry point on the Today tab: unread alert count and the next subscription charge, with links
 * to the Alerts and Subscriptions screens. Renders nothing while loading or when the server
 * cannot be reached (the rest of Today already says so).
 */
export function WatchdogCard() {
  const { api } = useApi();
  const router = useRouter();
  const p = usePalette();
  const { data } = useScreenData(async (a) => {
    const [alerts, subs] = await Promise.all([a.alerts(), a.subscriptions(14)]);
    return { unread: alerts.unread_count, subs };
  });
  if (!api || !data) return null;

  const next = nextChargeText(data.subs.upcoming, data.subs.as_of, 14);
  const hikes = data.subs.price_hikes.length;
  const title = data.unread > 0 ? `${data.unread} unread alert${data.unread === 1 ? "" : "s"}` : "No alerts";
  return (
    <Card>
      <Pressable
        onPress={() => router.push("/alerts")}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Open alerts`}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <RNText style={{ color: p.text, fontSize: 18, fontWeight: "800", flex: 1 }}>Watchdog</RNText>
        <CountBubble count={data.unread} label={`${data.unread} unread alerts`} />
      </Pressable>
      <RNText style={{ color: p.muted, fontSize: 14, marginTop: 4 }}>
        {title}
        {hikes > 0 ? ` · ${hikes} price increase${hikes === 1 ? "" : "s"}` : ""}
      </RNText>
      {next ? <RNText style={{ color: p.muted, fontSize: 14, marginTop: 2 }}>{next}</RNText> : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <ChunkyButton compact label="Alerts" icon="shield-alert-outline" onPress={() => router.push("/alerts")} />
        </View>
        <View style={{ flex: 1 }}>
          <ChunkyButton compact outline label="Subscriptions" icon="calendar-sync-outline" onPress={() => router.push("/subscriptions")} />
        </View>
      </View>
    </Card>
  );
}
