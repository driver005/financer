import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Card, Dot, ListItem, Section, useColors } from "@financer/ui";

import { useApi } from "@/api/config";
import { addDays, byStart, expand, longDay, timeRange, type Occurrence } from "@/calendar";
import { loadFeeds } from "@/calendarFeeds";
import { ruleFromDto } from "@/calendarForm";
import { toTone } from "@/calendarTones";
import { localIsoDate } from "@/period";

const SHOWN = 4;

/**
 * "Coming up" on the Today tab: the next events of the calendar (own events and the ones from
 * money, meals and shopping) in the next two days. Leaves itself out when nothing is planned or the
 * calendar cannot be reached, so Today never shows an error for it.
 */
export function UpcomingCard() {
  const { api } = useApi();
  const router = useRouter();
  const colors = useColors();
  const [items, setItems] = useState<Occurrence[]>([]);
  const today = localIsoDate();

  useFocusEffect(
    useCallback(() => {
      if (!api) return;
      let live = true;
      const to = addDays(today, 2);
      void (async () => {
        try {
          const [calendars, events, feeds] = await Promise.all([api.calendars(), api.calendarEvents(today, to), loadFeeds(api, today, to, new Set())]);
          const own = events.flatMap((e) => {
            const cal = calendars.find((c) => c.id === e.calendar_id);
            return cal?.visible ? expand(ruleFromDto(e), today, to, toTone(cal.tone)) : [];
          });
          if (live) setItems([...own, ...feeds].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : byStart(a, b))));
        } catch {
          if (live) setItems([]);
        }
      })();
      return () => {
        live = false;
      };
    }, [api, today]),
  );

  if (items.length === 0) return null;
  return (
    <Section title="Coming up" action={{ label: "Calendar", onPress: () => router.push("/calendar") }}>
      <Card padded={false}>
        {items.slice(0, SHOWN).map((o) => (
          <ListItem
            key={o.key}
            leading={<Dot color={colors.tones[o.tone].solid} />}
            title={o.title}
            subtitle={`${o.startDate === today ? "Today" : longDay(o.startDate, today)} · ${o.allDay ? "All day" : timeRange(o)}`}
            onPress={() => router.push((o.href ?? "/calendar") as never)}
            chevron
          />
        ))}
      </Card>
    </Section>
  );
}
