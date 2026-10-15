import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, ScrollView, Text as RNText, View } from "react-native";

import type { Idea, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { Avatar, Badge, EmptyState, FilterChip, MatchRing, Money, Panel, SkeletonCards, Subtitle, space } from "@/components/grocery/primitives";
import { ChunkyButton, HelperText, List, Text, TextInput } from "@/components/kit";
import { Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, parseEuroInput, servingsText } from "@/format";
import { costPerServing, initials, mealTint, shortList } from "@/groceryView";
import { useScreenData } from "@/hooks";
import { usePalette } from "@/theme";

const TAGS = ["vegetarisch", "vegan", "günstig", "schnell", "fleisch", "fisch"];

export default function Recipes() {
  const { api, loaded } = useApi();
  const c = useColors();
  const router = useRouter();
  const [tag, setTag] = useState<string | undefined>();
  const [budgetText, setBudgetText] = useState("");
  const budget = budgetText.trim() ? parseEuroInput(budgetText) : null;

  const { data, error, busy } = useScreenData(
    useCallback((a) => a.recipes({ tag, budgetCents: budget ?? undefined, limit: 20 }), [tag, budget]),
  );
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideaMessage, setIdeaMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const askForIdeas = useCallback(async () => {
    if (!api) return;
    setAsking(true);
    setIdeaMessage(null);
    try {
      setIdeas(await api.ideas({ count: 3, diet: tag, budget_cents: budget ?? undefined }));
    } catch (e) {
      setIdeaMessage(e instanceof Error ? e.message : "Could not get ideas");
    } finally {
      setAsking(false);
    }
  }, [api, tag, budget]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const loading = busy && !data;

  return (
    <Screen>
      <Title>Recipes</Title>
      {api ? <Subtitle>Ranked by how much you already buy.</Subtitle> : null}
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.xl }}
          ListHeaderComponent={
            <View style={{ marginBottom: space.sm }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs, paddingRight: space.lg }}
                style={{ marginHorizontal: -space.lg, paddingHorizontal: space.lg, flexGrow: 0 }}
              >
                <FilterChip label="All" selected={!tag} onPress={() => setTag(undefined)} />
                {TAGS.map((t) => (
                  <FilterChip key={t} label={t} selected={tag === t} onPress={() => setTag(tag === t ? undefined : t)} />
                ))}
              </ScrollView>
              <TextInput
                mode="outlined"
                dense
                label="Max. cost of missing ingredients (€)"
                accessibilityLabel="Max. cost of missing ingredients in euro"
                value={budgetText}
                onChangeText={setBudgetText}
                keyboardType="decimal-pad"
                style={{ marginTop: space.md }}
                error={budgetText.trim() !== "" && budget === null}
              />
              <View style={{ marginTop: space.lg, gap: space.sm }}>
                <ChunkyButton label="Plan my week" icon="calendar-week" onPress={() => router.push("/mealplan")} />
                <ChunkyButton
                  label={asking ? "Thinking…" : "Surprise me with new ideas"}
                  icon="creation"
                  tone="blue"
                  onPress={askForIdeas}
                  disabled={asking}
                />
              </View>
              {ideaMessage ? <HelperText type="error" visible>{ideaMessage}</HelperText> : null}
              {ideas.length > 0 ? (
                <View style={{ marginTop: space.lg }}>
                  {ideas.map((idea) => (
                    <IdeaCard key={idea.title} idea={idea} />
                  ))}
                </View>
              ) : null}
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}
              {loading ? (
                <View style={{ marginTop: space.lg }}>
                  <SkeletonCards count={3} label="Loading recipes" />
                </View>
              ) : null}
              {data && data.length > 0 ? (
                <RNText
                  accessibilityRole="header"
                  style={{ color: c.muted, fontSize: 12, fontWeight: "800", marginTop: space.lg }}
                >
                  {`${data.length} recipe${data.length === 1 ? "" : "s"}`}
                </RNText>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            busy ? undefined : (
              <EmptyState
                mood="worried"
                title="No recipe fits these filters"
                body="Try another diet or a higher limit for the missing ingredients."
                actionLabel={tag || budgetText ? "Clear filters" : undefined}
                actionIcon="filter-remove-outline"
                onAction={
                  tag || budgetText
                    ? () => {
                        setTag(undefined);
                        setBudgetText("");
                      }
                    : undefined
                }
              />
            )
          }
          renderItem={({ item, index }) => <RecipeCard recipe={item} best={index === 0} />}
        />
      )}
    </Screen>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <MaterialCommunityIcons name={icon as never} size={14} color={p.muted} />
      <RNText style={{ color: p.muted, fontSize: 13 }}>{text}</RNText>
    </View>
  );
}

function RecipeCard({ recipe: r, best }: { recipe: RecipeMatch; best: boolean }) {
  const p = usePalette();
  const names = new Map(r.ingredients.map((i) => [i.item, i.name]));
  const nameOf = (k: string) => names.get(k) ?? k;
  const perServing = costPerServing(r);
  const missing = shortList(r.missing.map((k) => nameOf(k) + (r.unpriced.includes(k) ? " (no price yet)" : "")), 2);
  const offers = shortList(r.on_offer.map(nameOf), 2);
  return (
    <Panel>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Avatar tint={mealTint(r.id)} label={initials(r.title)} size={48} square />
        <View style={{ flex: 1, gap: 2 }}>
          {best ? <Badge tone="good" label="Best match" icon="star" /> : null}
          <Text variant="titleMedium" accessibilityRole="header">{r.title}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.md }}>
            <Meta icon="clock-outline" text={`${r.minutes} min`} />
            <Meta icon="account-multiple-outline" text={servingsText(r.servings)} />
          </View>
        </View>
        <MatchRing percent={r.coverage_percent} label={`You already buy ${r.coverage_percent} percent of the ingredients`} />
      </View>

      {r.tags.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
          {r.tags.map((t) => (
            <Badge key={t} tone="muted" label={t} />
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        {perServing !== null ? (
          <>
            <Money text={perServing === 0 ? "no price yet" : formatCents(perServing)} size="lg" />
            {perServing !== 0 ? <RNText style={{ color: p.muted, fontSize: 14 }}>to buy per serving</RNText> : null}
          </>
        ) : (
          <Badge tone="good" label="Nothing to buy" icon="check-circle-outline" />
        )}
      </View>

      {r.missing.length ? (
        <Text variant="bodyMedium" style={{ marginTop: space.sm }}>
          <RNText style={{ fontWeight: "700" }}>Missing: </RNText>
          {missing.shown.join(", ")}
          {missing.more ? ` +${missing.more} more` : ""}
          {r.missing_cost_cents > 0 ? ` · about ${formatCents(r.missing_cost_cents)} in all for the priced ones` : ""}
        </Text>
      ) : null}

      {r.on_offer.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
          {offers.shown.map((n) => (
            <Badge key={n} tone="offer" label={`On offer: ${n}`} icon="tag" />
          ))}
          {offers.more ? <Badge tone="offer" label={`+${offers.more}`} /> : null}
        </View>
      ) : null}

      <List.Accordion title="Ingredients and steps">
        {r.ingredients.map((i) => (
          <List.Item key={i.item} title={i.name} description={i.amount} />
        ))}
        {r.steps.map((s, n) => (
          <List.Item key={n} title={`${n + 1}. ${s}`} titleNumberOfLines={6} />
        ))}
      </List.Accordion>
    </Panel>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <Panel tone="accent">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Avatar tint={mealTint(idea.title)} label={initials(idea.title)} size={48} square />
        <View style={{ flex: 1, gap: 2 }}>
          <Badge tone="accent" label="New idea" icon="creation" />
          <Text variant="titleMedium">{idea.title}</Text>
        </View>
      </View>
      <Text variant="bodyMedium" style={{ marginTop: space.sm }}>{idea.summary}</Text>
      <View style={{ flexDirection: "row", columnGap: space.md, marginTop: space.sm }}>
        <Meta icon="clock-outline" text={`${idea.minutes} min`} />
        <Meta icon="account-multiple-outline" text={servingsText(idea.servings)} />
      </View>
      <List.Accordion title="Ingredients and steps">
        {idea.ingredients.map((i, n) => (
          <List.Item key={`${i.name}-${n}`} title={i.name} description={i.amount} />
        ))}
        {idea.steps.map((s, n) => (
          <List.Item key={n} title={`${n + 1}. ${s}`} titleNumberOfLines={6} />
        ))}
      </List.Accordion>
    </Panel>
  );
}
