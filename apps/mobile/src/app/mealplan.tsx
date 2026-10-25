import { SectionSwitch } from "@/components/SectionSwitch";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text as RNText, View, type LayoutChangeEvent, type ScrollViewInstance } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import type { MealShoppingList, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { getSecret, setSecret } from "@/api/storage";
import { Avatar, Badge, EmptyState, Panel, RoundIcon, SectionLabel, SkeletonCards, Stepper, Subtitle, Tap, space, useTones } from "@/components/grocery/primitives";
import { ChunkyButton, HelperText, Text } from "@/components/kit";
import { MealPicker } from "@/components/MealPicker";
import { ListSummaryBar, PantryEditor, ShoppingListView, hasShoppingContent } from "@/components/ShoppingListView";
import { Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { initials, mealTint } from "@/groceryView";
import { usePalette } from "@/theme";
import {
  RELATION_LABEL,
  clampServings,
  parseTicks,
  planFromDays,
  planToInput,
  plannedCount,
  pruneTicks,
  serializeTicks,
  setDay,
  shiftWeek,
  shortDate,
  ticksKey,
  toggleTick,
  weekDays,
  weekLabel,
  weekRelation,
  weekStart,
  weekdayName,
  type MealEntry,
  type WeekPlan,
} from "@/mealplan";
import { localIsoDate } from "@/period";

export default function MealPlanScreen() {
  const { api, loaded } = useApi();
  const today = localIsoDate();
  const [week, setWeek] = useState(() => weekStart(localIsoDate()));
  const [plan, setPlan] = useState<WeekPlan>({});
  const [list, setList] = useState<MealShoppingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickDay, setPickDay] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeMatch[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [pantryOpen, setPantryOpen] = useState(false);
  const [tickState, setTickState] = useState<{ week: string; ids: string[] }>({ week, ids: [] });
  // answers of older requests (another week, an earlier save) are dropped
  const latest = useRef(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const cardY = useRef<Record<string, number>>({});
  const reduceMotion = useReducedMotion();

  const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

  const load = useCallback(async () => {
    if (!api) return;
    const id = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const [saved, shopping] = await Promise.all([api.mealPlan(week), api.mealShoppingList(week, localIsoDate())]);
      if (id !== latest.current) return;
      setPlan(planFromDays(saved.days));
      setList(shopping);
    } catch (e) {
      if (id === latest.current) setError(message(e));
    } finally {
      if (id === latest.current) setBusy(false);
    }
  }, [api, week]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ticks are kept per week on this device
  useEffect(() => {
    let alive = true;
    getSecret(ticksKey(week))
      .then((raw) => alive && setTickState({ week, ids: parseTicks(raw) }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [week]);
  const ticks = tickState.week === week ? tickState.ids : [];
  const shownTicks = list ? pruneTicks(ticks, list) : ticks;

  const toggle = (id: string) => {
    const ids = toggleTick(shownTicks, id);
    setTickState({ week, ids });
    void setSecret(ticksKey(week), serializeTicks(ids)).catch(() => undefined);
  };

  /** Show `next` at once, save it, and refresh the list from what the server stored. */
  const commit = async (next: WeekPlan) => {
    if (!api) return;
    const id = ++latest.current;
    setPlan(next);
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveMealPlan(week, planToInput(next, week));
      const shopping = await api.mealShoppingList(week, localIsoDate());
      if (id !== latest.current) return;
      setPlan(planFromDays(saved.days));
      setList(shopping);
    } catch (e) {
      if (id !== latest.current) return;
      setError(message(e));
      void load(); // fall back to what the server has
    } finally {
      if (id === latest.current) setBusy(false);
    }
  };

  const openPicker = async (iso: string) => {
    setPickDay(iso);
    if (!api || recipes.length > 0) return;
    setRecipesLoading(true);
    try {
      setRecipes(await api.recipes({ limit: 50 }));
    } catch (e) {
      setError(message(e));
    } finally {
      setRecipesLoading(false);
    }
  };

  const pick = (iso: string, entry: MealEntry) => {
    setPickDay(null);
    void commit(setDay(plan, iso, entry));
  };

  const changeServings = (iso: string, entry: MealEntry, delta: number) => {
    const servings = clampServings(entry.servings + delta);
    if (servings !== entry.servings) void commit(setDay(plan, iso, { ...entry, servings }));
  };

  if (!loaded) return <Screen><Loading /></Screen>;

  const relation = RELATION_LABEL[weekRelation(week, today)];
  const showBar = !!list && hasShoppingContent(list);

  const jumpTo = (iso: string) => {
    const y = cardY.current[iso];
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - space.sm), animated: !reduceMotion });
  };

  return (
    <Screen>
      <Title>Meal plan</Title>
      <SectionSwitch />
      {!api ? (
        <NeedsSetup />
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
              <RoundIcon icon="chevron-left" onPress={() => setWeek(shiftWeek(week, -1))} label="Previous week" />
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text variant="titleSmall" style={{ fontVariant: ["tabular-nums"] }}>{weekLabel(week)}</Text>
                {relation ? <Text variant="bodySmall" className="text-muted">{relation}</Text> : null}
              </View>
              <RoundIcon icon="chevron-right" onPress={() => setWeek(shiftWeek(week, 1))} label="Next week" />
            </View>

            <WeekStrip days={weekDays(week)} plan={plan} today={today} onPick={jumpTo} />

            {relation !== "This week" ? (
              <View style={{ marginBottom: space.md }}>
                <ChunkyButton label="Back to this week" icon="calendar-today" outline onPress={() => setWeek(weekStart(today))} />
              </View>
            ) : null}
            {error ? <HelperText type="error" visible>{error}</HelperText> : null}

            <SectionLabel right={<Text variant="bodySmall" className="text-muted">{plannedCount(plan)} of 7 planned</Text>}>Meals</SectionLabel>
            {weekDays(week).map((iso) => (
              <View
                key={iso}
                onLayout={(e: LayoutChangeEvent) => {
                  cardY.current[iso] = e.nativeEvent.layout.y;
                }}
              >
                <DayCard
                  iso={iso}
                  today={today}
                  entry={plan[iso]}
                  onPick={() => void openPicker(iso)}
                  onClear={() => void commit(setDay(plan, iso, null))}
                  onServings={(entry, delta) => changeServings(iso, entry, delta)}
                >
                  {pickDay === iso ? (
                    <MealPicker api={api} recipes={recipes} loading={recipesLoading} onPick={(e) => pick(iso, e)} onClose={() => setPickDay(null)} />
                  ) : null}
                </DayCard>
              </View>
            ))}

            <SectionLabel>Shopping list</SectionLabel>
            {busy && !list ? <SkeletonCards count={2} label="Loading the shopping list" /> : null}
            {list && (hasShoppingContent(list) || plannedCount(plan) > 0) ? (
              <ShoppingListView list={list} ticks={shownTicks} onToggle={toggle} onEditPantry={() => setPantryOpen(true)} />
            ) : null}
            {pantryOpen ? <PantryEditor api={api} onChanged={() => void load()} onClose={() => setPantryOpen(false)} /> : null}
            {plannedCount(plan) === 0 && !busy && !error ? (
              <EmptyState
                title="Nothing planned this week"
                body="Pick a recipe for a day and the ingredients land on your shopping list, grouped by chain."
                actionLabel="Plan Monday"
                actionIcon="plus"
                onAction={() => {
                  const first = weekDays(week)[0];
                  void openPicker(first);
                  jumpTo(first);
                }}
              />
            ) : null}
          </ScrollView>
          {showBar && list ? <ListSummaryBar list={list} ticks={shownTicks} /> : null}
        </View>
      )}
    </Screen>
  );
}

/** Seven pills, Monday to Sunday: today filled, a dot under every day that has a meal. Tap jumps to the day. */
function WeekStrip({ days, plan, today, onPick }: { days: string[]; plan: WeekPlan; today: string; onPick: (iso: string) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 6, marginBottom: space.md }}>
      {days.map((iso) => {
        const isToday = iso === today;
        const meal = plan[iso];
        return (
          <Tap
            key={iso}
            onPress={() => onPick(iso)}
            accessibilityLabel={`${weekdayName(iso)} ${shortDate(iso)}${isToday ? ", today" : ""}${meal ? `, ${meal.title}` : ", nothing planned"}`}
            style={{
              flex: 1,
              minHeight: 64,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: isToday ? p.accent : p.border,
              borderBottomWidth: isToday ? 2 : 1,
              borderBottomColor: isToday ? p.accentEdge : p.border,
              backgroundColor: isToday ? p.accent : p.surface,
            }}
          >
            <RNText style={{ color: isToday ? p.onAccent : p.muted, fontSize: 12, fontWeight: "800" }} numberOfLines={1}>
              {weekdayName(iso)}
            </RNText>
            <RNText style={{ color: isToday ? p.onAccent : p.text, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }} numberOfLines={1}>
              {Number(iso.slice(8, 10))}
            </RNText>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: meal ? (isToday ? p.onAccent : p.accent) : "transparent" }} />
          </Tap>
        );
      })}
    </View>
  );
}

function DayCard({
  iso,
  today,
  entry,
  onPick,
  onClear,
  onServings,
  children,
}: {
  iso: string;
  today: string;
  entry: MealEntry | undefined;
  onPick: () => void;
  onClear: () => void;
  onServings: (entry: MealEntry, delta: number) => void;
  children?: ReactNode;
}) {
  const p = usePalette();
  const tones = useTones();
  const isToday = iso === today;
  return (
    <Panel padding={space.md} tone={isToday ? "accent" : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: entry ? space.sm : 0 }}>
        <RNText style={{ color: isToday ? tones.accent.fg : p.text, fontSize: 14, fontWeight: "800" }}>{weekdayName(iso)}</RNText>
        <RNText style={{ color: p.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>{shortDate(iso)}</RNText>
        {isToday ? (
          <View style={{ alignSelf: "center" }}>
            <Badge tone="accent" label="Today" />
          </View>
        ) : null}
        {entry ? null : (
          <Tap
            onPress={onPick}
            accessibilityLabel={`Pick a recipe for ${weekdayName(iso)}`}
            style={{ marginLeft: "auto", minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm }}
          >
            <RNText style={{ color: p.accent, fontSize: 18, fontWeight: "800" }}>+</RNText>
            <RNText style={{ color: p.accent, fontSize: 15, fontWeight: "700" }}>Pick a recipe</RNText>
          </Tap>
        )}
      </View>
      {entry ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Avatar tint={mealTint(entry.title)} label={initials(entry.title)} size={48} square />
          <View style={{ flex: 1, gap: space.sm }}>
            <Text variant="titleSmall" numberOfLines={2}>{entry.title}</Text>
            <Stepper
              value={entry.servings}
              unit={entry.servings === 1 ? "serving" : "servings"}
              onMinus={() => onServings(entry, -1)}
              onPlus={() => onServings(entry, 1)}
              minusLabel={`Fewer servings of ${entry.title}`}
              plusLabel={`More servings of ${entry.title}`}
            />
          </View>
          <View>
            <RoundIcon icon="swap-horizontal" onPress={onPick} label={`Change the meal on ${weekdayName(iso)}`} />
            <RoundIcon icon="close" onPress={onClear} label={`Clear the meal on ${weekdayName(iso)}`} />
          </View>
        </View>
      ) : null}
      {children}
    </Panel>
  );
}
