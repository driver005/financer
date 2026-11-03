import { useEffect, useRef } from "react";
import { type GestureResponderEvent, Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";

import { opacity, overlap } from "../constants/misc";
import { borderWidth } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useTheme } from "../theme/ThemeProvider";
import type { CalendarItem, DayColumn, TimeBlock } from "./types";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SLOT_MINUTES = 30;
/** The hour the view scrolls to when it opens. */
const FIRST_HOUR = 7;

/**
 * The week, three days or one day as columns with hours down the side. An all-day strip sits above;
 * timed events are blocks placed by their minutes, side by side when they overlap; a line marks now
 * in today's column. Tapping an empty place calls `onSlot` with the day and the half hour.
 */
export function TimeGrid({ days, nowMinutes, onSlot, onSelectDay }: { days: DayColumn[]; nowMinutes?: number; onSlot: (date: string, minutes: number) => void; onSelectDay?: (date: string) => void }) {
  const { colors } = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  const hour = size.calendar.hour;
  useEffect(() => {
    scroller.current?.scrollTo({ y: FIRST_HOUR * hour, animated: false });
  }, [hour, days.length]);
  const hair = { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border.default } as const;
  const side = { borderLeftWidth: borderWidth.hairline, borderLeftColor: colors.border.default } as const;
  const strip = days.some((d) => d.allDay.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: size.calendar.gutter }} />
        {days.map((d) => (
          <View key={d.date} style={{ flex: 1, minWidth: 0 }}>
            <Touchable onPress={onSelectDay ? () => onSelectDay(d.date) : undefined} label={`${d.label} ${d.number}${d.today ? ", today" : ""}`} hit={false} align="center" py="xs" gap="2xs" disabled={!onSelectDay}>
              <Text variant="caption" tone={d.today ? "accent" : "muted"}>{d.label}</Text>
              <Box dim="icon-xl" radius="full" align="center" justify="center" bg={d.today ? "accent-solid" : undefined}>
                <Text variant="bodyStrong" tone={d.today ? "on-accent-solid" : "default"}>{d.number}</Text>
              </Box>
            </Touchable>
          </View>
        ))}
      </View>
      {strip ? (
        <View style={{ flexDirection: "row", ...hair }}>
          <View style={{ width: size.calendar.gutter, alignItems: "flex-end", paddingRight: space.xs, paddingTop: space.xs }}>
            <Text variant="caption" tone="subtle" numberOfLines={1}>all day</Text>
          </View>
          {days.map((d) => (
            <View key={d.date} style={{ flex: 1, minWidth: 0, padding: space["2xs"], gap: space["2xs"], ...side }}>
              {d.allDay.map((it) => (
                <AllDayChip key={it.key} item={it} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <ScrollView ref={scroller} style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", height: hour * 24 }}>
          <View style={{ width: size.calendar.gutter }}>
            {HOURS.slice(1).map((h) => (
              <View key={h} style={{ position: "absolute", top: h * hour - space.sm, right: space.xs }}>
                <Text variant="caption" tone="subtle">{`${String(h).padStart(2, "0")}:00`}</Text>
              </View>
            ))}
          </View>
          {days.map((d) => (
            <View key={d.date} style={{ flex: 1, minWidth: 0, ...side }}>
              <Pressable
                accessibilityLabel={`Add an event on ${d.label} ${d.number}`}
                accessibilityRole="button"
                onPress={(e: GestureResponderEvent) => onSlot(d.date, Math.max(0, Math.floor(e.nativeEvent.locationY / hour * (60 / SLOT_MINUTES))) * SLOT_MINUTES)}
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: d.today ? colors.tones.accent.soft : "transparent", opacity: d.today ? opacity[25] : opacity[100] }}
              />
              {HOURS.slice(1).map((h) => (
                <View key={h} pointerEvents="none" style={{ position: "absolute", top: h * hour, left: 0, right: 0, ...hair }} />
              ))}
              {[...d.blocks].sort((a, b) => a.depth - b.depth).map((b) => (
                <Block key={b.key} block={b} />
              ))}
              {d.today && nowMinutes !== undefined ? (
                <View pointerEvents="none" style={{ position: "absolute", top: (nowMinutes / 60) * hour - size.stroke.sm, left: 0, right: 0, height: size.stroke.sm * 2, backgroundColor: colors.tones.danger.solid }} />
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function AllDayChip({ item }: { item: CalendarItem }) {
  const body = (
    <Box bg={`${item.tone}-solid`} radius="sm" px="xs">
      <Text variant="caption" tone={`on-${item.tone}-solid`} numberOfLines={1}>{item.title}</Text>
    </Box>
  );
  return item.onPress ? <Touchable onPress={item.onPress} label={item.title} hit={false}>{body}</Touchable> : body;
}

/**
 * One event. Events that overlap in time lie on top of each other, each a little further right so
 * every title stays readable, and each fill is see-through: where two overlap their colours mix
 * (blue over green looks teal), so a clash is visible at a glance. Events that start together
 * (their titles would hide each other) share the width side by side instead.
 */
function Block({ block: b }: { block: TimeBlock }) {
  const { colors } = useTheme();
  const hour = size.calendar.hour;
  const tall = b.bottom - b.top >= 45;
  const indent = Math.min(overlap.indent, overlap.spread / Math.max(1, b.depths - 1));
  const from = b.depth * indent;
  const share = (100 - from) / b.lanes;
  return (
    <View
      style={{
        position: "absolute",
        top: (b.top / 60) * hour,
        height: ((b.bottom - b.top) / 60) * hour - size.stroke.hair,
        left: `${from + b.lane * share}%`,
        width: `${share}%`,
        paddingRight: size.stroke.sm,
      }}
    >
      <Touchable onPress={b.onPress} label={b.subtitle ? `${b.title}, ${b.subtitle}` : b.title} hit={false} radius="md" overflow="hidden" grow>
        <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.tones[b.tone].solid, opacity: opacity[40] }} />
        <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: size.stroke.md, backgroundColor: colors.tones[b.tone].solid }} />
        <Box p="xs" pl="sm">
          <Text variant="caption" tone={`on-${b.tone}-soft`} numberOfLines={tall ? 2 : 1}>{b.title}</Text>
          {tall && b.subtitle ? <Text variant="caption" tone={`on-${b.tone}-soft`} numberOfLines={1}>{b.subtitle}</Text> : null}
        </Box>
      </Touchable>
    </View>
  );
}
