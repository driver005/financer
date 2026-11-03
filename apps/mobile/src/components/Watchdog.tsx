import { useRouter } from "expo-router";
import { Badge, Group, ListItem, Section } from "@financer/ui";

import { useApi } from "@/api/config";
import { useScreenData } from "@/hooks";
import { nextChargeText } from "@/watchdog";

/** A round counter, e.g. the number of unread alerts. Nothing at zero. */
export function CountBubble({ count }: { count: number }) {
  if (count <= 0) return null;
  return <Badge label={count > 99 ? "99+" : `${count}`} tone="danger" solid />;
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
    <Section title="Watchdog">
      <Group>
        <ListItem
          icon="shield-alert-outline"
          tile
          tone={data.unread > 0 ? "danger" : "default"}
          title={title}
          subtitle={hikes > 0 ? `${hikes} price increase${hikes === 1 ? "" : "s"}` : "Nothing unusual in your bookings"}
          trailing={<CountBubble count={data.unread} />}
          onPress={() => router.push("/alerts")}
          label={`${title}. Open alerts`}
        />
        <ListItem
          icon="calendar-sync-outline"
          tile
          title={next ?? "No charges due soon"}
          subtitle="Subscriptions"
          onPress={() => router.push("/subscriptions")}
          label={`${next ?? "No charges due soon"}. Open subscriptions`}
        />
      </Group>
    </Section>
  );
}
