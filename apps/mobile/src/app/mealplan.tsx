import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Card, HeroCard, HeroChip, HeroNumber, HeroProgress, IconBadge, IconButton, Note, Row, Sheet, Stepper, Text, Touchable } from "@financer/ui";

import type { MealShoppingList, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { getSecret, setSecret } from "@/api/storage";
import { MealPicker } from "@/components/MealPicker";
import { Page } from "@/components/Page";
import { SectionSwitch } from "@/components/SectionSwitch";
import { ListSummaryBar, PantryEditor, ShoppingListView, hasShoppingContent } from "@/components/ShoppingListView";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { initials, mealTone } from "@/groceryView";
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

  if (!loaded) return <Page title="Meal plan"><Loading /></Page>;
  if (!api) return <Page title="Meal plan"><SectionSwitch /><NeedsSetup /></Page>;

  const relation = RELATION_LABEL[weekRelation(week, today)];
  const showBar = !!list && hasShoppingContent(list);
  const days = weekDays(week);

  return (
    <Page title="Meal plan" footer={showBar && list ? <ListSummaryBar list={list} ticks={shownTicks} /> : undefined}>
      <SectionSwitch />
      <Row gap="sm">
        <IconButton icon="chevron-left" label="Previous week" onPress={() => setWeek(shiftWeek(week, -1))} />
        <Box grow align="center">
          <Text variant="bodyStrong">{weekLabel(week)}</Text>
          {relation ? <Text variant="caption" tone="muted">{relation}</Text> : null}
        </Box>
        <IconButton icon="chevron-right" label="Next week" onPress={() => setWeek(shiftWeek(week, 1))} />
      </Row>

      <HeroCard label="Meals planned" chip={relation ? <HeroChip icon="calendar-week" text={relation} /> : null}>
        <HeroNumber value={`${plannedCount(plan)}`} suffix="of 7 days" label={`${plannedCount(plan)} of 7 days planned`} />
        <HeroProgress progress={plannedCount(plan) / 7} label={`${plannedCount(plan)} of 7 days planned`} />
      </HeroCard>

      <WeekStrip days={days} plan={plan} today={today} onPick={(iso) => void openPicker(iso)} />

      {relation !== "This week" ? <Button label="Back to this week" icon="calendar-today" variant="outline" onPress={() => setWeek(weekStart(today))} /> : null}
      {error ? <Note tone="error">{error}</Note> : null}

      <Box gap="sm">
        <Text variant="heading" level={2}>Meals</Text>
        {days.map((iso) => (
          <DayCard
            key={iso}
            iso={iso}
            today={today}
            entry={plan[iso]}
            onPick={() => void openPicker(iso)}
            onClear={() => void commit(setDay(plan, iso, null))}
            onServings={(entry, delta) => changeServings(iso, entry, delta)}
          />
        ))}
      </Box>

      <Box gap="sm">
        <Text variant="heading" level={2}>Shopping list</Text>
        {busy && !list ? <Loading rows={2} /> : null}
        {list && (hasShoppingContent(list) || plannedCount(plan) > 0) ? <ShoppingListView list={list} ticks={shownTicks} onToggle={toggle} onEditPantry={() => setPantryOpen(true)} /> : null}
        {plannedCount(plan) === 0 && !busy && !error ? (
          <Empty
            title="Nothing planned this week"
            message="Pick a recipe for a day and the ingredients land on your shopping list, grouped by chain."
            actionLabel="Plan Monday"
            actionIcon="plus"
            onAction={() => void openPicker(days[0])}
          />
        ) : null}
      </Box>

      <Sheet visible={pickDay !== null} onClose={() => setPickDay(null)} title={pickDay ? `Choose a recipe for ${weekdayName(pickDay)}` : undefined}>
        {pickDay ? <MealPicker api={api} recipes={recipes} loading={recipesLoading} onPick={(e) => pick(pickDay, e)} /> : null}
      </Sheet>
      <Sheet visible={pantryOpen} onClose={() => setPantryOpen(false)} title="Pantry list">
        {pantryOpen ? <PantryEditor api={api} onChanged={() => void load()} onClose={() => setPantryOpen(false)} /> : null}
      </Sheet>
    </Page>
  );
}

/** Seven pills, Monday to Sunday: today filled, a dot under every day that has a meal. Tap picks the meal for that day. */
function WeekStrip({ days, plan, today, onPick }: { days: string[]; plan: WeekPlan; today: string; onPick: (iso: string) => void }) {
  return (
    <Row gap="xs" align="stretch">
      {days.map((iso) => {
        const isToday = iso === today;
        const meal = plan[iso];
        return (
          <Box key={iso} equal>
            <Touchable
              onPress={() => onPick(iso)}
              label={`${weekdayName(iso)} ${shortDate(iso)}${isToday ? ", today" : ""}${meal ? `, ${meal.title}` : ", nothing planned"}`}
              bg={isToday ? "accent-solid" : "surface"}
              shadow={isToday ? undefined : "surface"}
              radius="2xl"
              py="sm"
              gap="2xs"
              align="center"
              justify="center"
              grow
            >
              <Text variant="caption" tone={isToday ? "on-accent-solid" : "muted"} numberOfLines={1}>{weekdayName(iso)}</Text>
              <Text variant="bodyStrong" tone={isToday ? "on-accent-solid" : "default"} numberOfLines={1}>{`${Number(iso.slice(8, 10))}`}</Text>
              <Box dim="icon-xs" radius="full" bg={meal ? (isToday ? "accent-soft" : "accent-solid") : undefined} />
            </Touchable>
          </Box>
        );
      })}
    </Row>
  );
}

function DayCard({
  iso,
  today,
  entry,
  onPick,
  onClear,
  onServings,
}: {
  iso: string;
  today: string;
  entry: MealEntry | undefined;
  onPick: () => void;
  onClear: () => void;
  onServings: (entry: MealEntry, delta: number) => void;
}) {
  const isToday = iso === today;
  return (
    <Card tone={isToday ? "accent" : undefined} gap="md">
      <Row gap="sm">
        <Text variant="bodyStrong" tone={isToday ? "on-accent-soft" : "default"}>{weekdayName(iso)}</Text>
        <Text variant="caption" tone={isToday ? "on-accent-soft" : "muted"}>{shortDate(iso)}</Text>
        {isToday ? <Badge tone="accent" solid label="Today" /> : null}
        {entry ? null : (
          <Box grow align="end">
            <Button size="sm" variant="ghost" icon="plus" label="Pick a recipe" onPress={onPick} />
          </Box>
        )}
      </Row>
      {entry ? (
        <Row gap="md">
          <IconBadge tone={mealTone(entry.title)} text={initials(entry.title)} square />
          <Box grow gap="sm">
            <Text variant="bodyStrong" numberOfLines={2}>{entry.title}</Text>
            <Stepper
              value={entry.servings}
              unit={entry.servings === 1 ? "serving" : "servings"}
              onMinus={() => onServings(entry, -1)}
              onPlus={() => onServings(entry, 1)}
              minusLabel={`Fewer servings of ${entry.title}`}
              plusLabel={`More servings of ${entry.title}`}
            />
          </Box>
          <Box>
            <IconButton icon="swap-horizontal" label={`Change the meal on ${weekdayName(iso)}`} onPress={onPick} />
            <IconButton icon="close" label={`Clear the meal on ${weekdayName(iso)}`} onPress={onClear} />
          </Box>
        </Row>
      ) : null}
    </Card>
  );
}
