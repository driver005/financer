import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { Chip, HelperText, List, Text, TextInput } from "@/components/kit";

import type { Idea, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { Bar, Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, parseEuroInput } from "@/format";
import { useScreenData } from "@/hooks";

const TAGS = ["vegetarisch", "vegan", "günstig", "schnell", "fleisch", "fisch"];

export default function Recipes() {
  const { api, loaded } = useApi();
  const c = useColors();
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

  return (
    <Screen>
      <Title>Recipes</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Chip selected={!tag} onPress={() => setTag(undefined)}>All</Chip>
                {TAGS.map((t) => (
                  <Chip key={t} selected={tag === t} onPress={() => setTag(tag === t ? undefined : t)}>{t}</Chip>
                ))}
              </View>
              <TextInput
                mode="outlined"
                dense
                label="Max. cost of missing ingredients (€)"
                accessibilityLabel="Max. cost of missing ingredients in euro"
                value={budgetText}
                onChangeText={setBudgetText}
                keyboardType="decimal-pad"
                style={{ marginTop: 12 }}
                error={budgetText.trim() !== "" && budget === null}
              />
              <View style={{ marginTop: 12 }}>
                <Button label={asking ? "Thinking…" : "Surprise me with new ideas"} icon="creation" mode="contained-tonal" onPress={askForIdeas} disabled={asking} />
              </View>
              {ideaMessage ? <HelperText type="error" visible>{ideaMessage}</HelperText> : null}
              {ideas.map((idea) => (
                <IdeaCard key={idea.title} idea={idea} />
              ))}
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}
              {busy && !data ? <Loading /> : null}
            </View>
          }
          ListEmptyComponent={busy ? null : <Body muted>No recipe fits these filters.</Body>}
          renderItem={({ item }) => <RecipeCard recipe={item} muted={c.muted} />}
        />
      )}
    </Screen>
  );
}

function RecipeCard({ recipe: r, muted }: { recipe: RecipeMatch; muted: string }) {
  const names = new Map(r.ingredients.map((i) => [i.item, i.name]));
  const nameOf = (k: string) => names.get(k) ?? k;
  return (
    <Card>
      <Text variant="titleMedium">{r.title}</Text>
      <Text variant="bodySmall" style={{ color: muted, marginVertical: 4 }}>
        {r.minutes} min · {r.servings} servings · {r.tags.join(", ")}
      </Text>
      <Bar progress={r.coverage_percent / 100} marginTop={0} />
      <Text variant="bodySmall" style={{ color: muted, marginTop: 4 }}>
        You already buy {r.coverage_percent}% of the ingredients
      </Text>
      {r.missing.length ? (
        <Text variant="bodyMedium" style={{ marginTop: 6 }}>
          Missing: {r.missing.map((k) => nameOf(k) + (r.unpriced.includes(k) ? " (no price yet)" : "")).join(", ")}
          {r.missing_cost_cents > 0 ? ` · about ${formatCents(r.missing_cost_cents)} for the priced ones` : ""}
        </Text>
      ) : null}
      {r.on_offer.length ? (
        <Text variant="bodyMedium" style={{ marginTop: 4 }}>On offer now: {r.on_offer.map(nameOf).join(", ")}</Text>
      ) : null}
      <List.Accordion title="Ingredients and steps">
        {r.ingredients.map((i) => (
          <List.Item key={i.item} title={i.name} description={i.amount} />
        ))}
        {r.steps.map((s, n) => (
          <List.Item key={n} title={`${n + 1}. ${s}`} titleNumberOfLines={6} />
        ))}
      </List.Accordion>
    </Card>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <Card>
      <Text variant="titleMedium">{idea.title}</Text>
      <Text variant="bodyMedium" style={{ marginVertical: 4 }}>{idea.summary}</Text>
      <Text variant="bodySmall">{idea.minutes} min · {idea.servings} servings</Text>
      <List.Accordion title="Ingredients and steps">
        {idea.ingredients.map((i, n) => (
          <List.Item key={`${i.name}-${n}`} title={i.name} description={i.amount} />
        ))}
        {idea.steps.map((s, n) => (
          <List.Item key={n} title={`${n + 1}. ${s}`} titleNumberOfLines={6} />
        ))}
      </List.Accordion>
    </Card>
  );
}
