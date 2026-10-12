import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import type { MealShoppingList, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { getSecret, setSecret } from "@/api/storage";
import { HelperText, IconButton, Text } from "@/components/kit";
import { MealPicker } from "@/components/MealPicker";
import { PantryEditor, ShoppingListView } from "@/components/ShoppingListView";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
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
  const c = useColors();
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

  if (!loaded) return <Screen><Loading /></Screen>;

  const relation = RELATION_LABEL[weekRelation(week, today)];

  return (
    <Screen>
      <Title>Meal plan</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <IconButton icon="chevron-left" onPress={() => setWeek(shiftWeek(week, -1))} accessibilityLabel="Previous week" />
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text variant="titleSmall">{weekLabel(week)}</Text>
              {relation ? <Text variant="bodySmall" style={{ color: c.muted }}>{relation}</Text> : null}
            </View>
            <IconButton icon="chevron-right" onPress={() => setWeek(shiftWeek(week, 1))} accessibilityLabel="Next week" />
          </View>
          {relation !== "This week" ? (
            <View style={{ marginBottom: 12 }}>
              <Button label="Back to this week" icon="calendar-today" mode="outlined" onPress={() => setWeek(weekStart(today))} />
            </View>
          ) : null}
          {error ? <HelperText type="error" visible>{error}</HelperText> : null}

          {weekDays(week).map((iso) => {
            const entry = plan[iso];
            return (
              <Card key={iso}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 52 }}>
                    <Text variant="titleSmall" style={{ color: iso === today ? c.accent : c.text }}>{weekdayName(iso)}</Text>
                    <Text variant="bodySmall" style={{ color: c.muted }}>{shortDate(iso)}</Text>
                  </View>
                  {entry ? (
                    <View style={{ flex: 1 }}>
                      <Body bold>{entry.title}</Body>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <IconButton icon="minus" onPress={() => changeServings(iso, entry, -1)} accessibilityLabel={`Fewer servings of ${entry.title}`} />
                        <Text variant="bodyMedium" style={{ minWidth: 76, textAlign: "center" }}>
                          {entry.servings} {entry.servings === 1 ? "serving" : "servings"}
                        </Text>
                        <IconButton icon="plus" onPress={() => changeServings(iso, entry, 1)} accessibilityLabel={`More servings of ${entry.title}`} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flex: 1 }}>
                      <Button label="Pick a recipe" icon="plus" mode="outlined" onPress={() => void openPicker(iso)} />
                    </View>
                  )}
                  {entry ? (
                    <View>
                      <IconButton icon="swap-horizontal" onPress={() => void openPicker(iso)} accessibilityLabel={`Change the meal on ${weekdayName(iso)}`} />
                      <IconButton icon="close" onPress={() => void commit(setDay(plan, iso, null))} accessibilityLabel={`Clear the meal on ${weekdayName(iso)}`} />
                    </View>
                  ) : null}
                </View>
                {pickDay === iso ? (
                  <MealPicker api={api} recipes={recipes} loading={recipesLoading} onPick={(e) => pick(iso, e)} onClose={() => setPickDay(null)} />
                ) : null}
              </Card>
            );
          })}

          <Title>Shopping list</Title>
          {busy && !list ? <Loading /> : null}
          {list ? (
            <ShoppingListView list={list} ticks={shownTicks} onToggle={toggle} onEditPantry={() => setPantryOpen(true)} />
          ) : null}
          {pantryOpen ? <PantryEditor api={api} onChanged={() => void load()} onClose={() => setPantryOpen(false)} /> : null}
          {plannedCount(plan) === 0 && !busy ? <Body muted>Nothing planned this week.</Body> : null}
        </ScrollView>
      )}
    </Screen>
  );
}
