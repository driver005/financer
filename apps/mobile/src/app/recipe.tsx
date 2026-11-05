import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Badge, Box, Card, IngredientRow, Note, ProgressRing, RecipeCover, RecipeFacts, RecipeStep, Row, ServingsPicker, Stack, Text, useLayout, type IngredientState, type RecipeFact } from "@financer/ui";

import type { Idea, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { formatCents, servingsText } from "@/format";
import { clampServings, costPerServing, initials, mealTone, scaleAmount } from "@/groceryView";
import { useScreenData } from "@/hooks";
import { IDEA_ID, stashedIdea } from "@/recipeStash";

/** What the page shows, whether the recipe is a bundled one (matched to your shopping) or a generated idea. */
type Shown = {
  id: string;
  title: string;
  summary?: string;
  minutes: number;
  servings: number;
  tags: string[];
  ingredients: { key: string; name: string; amount: string; state?: IngredientState }[];
  steps: string[];
  match?: RecipeMatch;
};

function fromMatch(r: RecipeMatch): Shown {
  const have = new Set(r.have);
  const offer = new Set(r.on_offer);
  return {
    id: r.id,
    title: r.title,
    minutes: r.minutes,
    servings: r.servings,
    tags: r.tags,
    ingredients: r.ingredients.map((i) => ({ key: i.item, name: i.name, amount: i.amount, state: offer.has(i.item) ? "offer" : have.has(i.item) ? "have" : "missing" })),
    steps: r.steps,
    match: r,
  };
}

function fromIdea(i: Idea): Shown {
  return {
    id: IDEA_ID,
    title: i.title,
    summary: i.summary,
    minutes: i.minutes,
    servings: i.servings,
    tags: [],
    ingredients: i.ingredients.map((x, n) => ({ key: `${x.name}-${n}`, name: x.name, amount: x.amount })),
    steps: i.steps,
  };
}

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { api, loaded } = useApi();
  const isIdea = id === IDEA_ID;
  const { data, error, busy } = useScreenData(useCallback((a) => (isIdea ? Promise.resolve<RecipeMatch[]>([]) : a.recipes({ limit: 50 })), [isIdea]));

  const shown = useMemo<Shown | null>(() => {
    if (isIdea) {
      const idea = stashedIdea();
      return idea ? fromIdea(idea) : null;
    }
    const found = data?.find((r) => r.id === id);
    return found ? fromMatch(found) : null;
  }, [isIdea, data, id]);

  if (!loaded) return <Page title="Recipe" back><Loading /></Page>;
  if (!api) return <Page title="Recipe" back><NeedsSetup /></Page>;
  if (!shown) {
    return (
      <Page title="Recipe" back>
        {error ? <Note tone="error">{error}</Note> : null}
        {busy || (!isIdea && !data) ? <Loading rows={3} /> : <Empty mood="worried" title="This recipe is not here any more" message="Go back to the list and pick another one." />}
      </Page>
    );
  }
  return <RecipePage recipe={shown} />;
}

function RecipePage({ recipe: r }: { recipe: Shown }) {
  const { layout } = useLayout();
  const wide = layout !== "compact";
  const [servings, setServings] = useState(r.servings);
  const m = r.match;
  const perServing = m ? costPerServing(m) : null;

  const facts: RecipeFact[] = [
    { icon: "clock-outline", label: "Time", value: `${r.minutes} min` },
    { icon: "account-multiple-outline", label: "Servings", value: servingsText(r.servings) },
  ];
  if (m) facts.push({ icon: "cash", label: "To buy per serving", value: perServing === null ? "Nothing" : perServing === 0 ? "No price yet" : formatCents(perServing) });

  const ingredients = (
    <Stack gap="md">
      <Text variant="heading" level={2}>Ingredients</Text>
      <ServingsPicker label="Servings" value={servings} unit={servings === 1 ? "serving" : "servings"} onChange={(n) => setServings(clampServings(n))} />
      <Card gap="none">
        {r.ingredients.map((i) => (
          <IngredientRow key={i.key} amount={scaleAmount(i.amount, servings, r.servings)} name={i.name} state={i.state} />
        ))}
      </Card>
      {m && m.missing.length > 0 ? (
        <Note tone="info">
          {m.missing_cost_cents > 0 ? `About ${formatCents(m.missing_cost_cents)} for the priced ingredients you do not buy yet.` : "These ingredients are not among your usual items yet."}
        </Note>
      ) : null}
    </Stack>
  );

  const method = (
    <Stack gap="md">
      <Text variant="heading" level={2}>Method</Text>
      <Card gap="xs">
        {r.steps.map((s, n) => (
          <RecipeStep key={n} n={n + 1} text={s} />
        ))}
      </Card>
    </Stack>
  );

  return (
    <Page title="Recipe" back>
      <Stack gap="lg">
        <RecipeCover tone={mealTone(r.id === IDEA_ID ? r.title : r.id)} letter={initials(r.title)}>
          {m ? (
            <ProgressRing progress={m.coverage_percent / 100} box="lg" stroke="md" label={`You already buy ${m.coverage_percent} percent of the ingredients`}>
              <Text variant="number">{`${m.coverage_percent}%`}</Text>
            </ProgressRing>
          ) : (
            <Badge tone="accent" label="New idea" icon="creation" />
          )}
        </RecipeCover>

        <Stack gap="sm">
          <Text variant="title" level={1}>{r.title}</Text>
          {r.summary ? <Text variant="body" tone="muted">{r.summary}</Text> : null}
          {r.tags.length > 0 || (m && m.on_offer.length > 0) ? (
            <Row gap="sm" wrap>
              {r.tags.map((t) => (
                <Badge key={t} label={t} />
              ))}
              {m && m.on_offer.length > 0 ? <Badge tone="warning" label={`${m.on_offer.length} on offer`} icon="tag" /> : null}
            </Row>
          ) : null}
        </Stack>

        <RecipeFacts facts={facts} />

        {wide ? (
          <Row gap="xl" align="start">
            <Box basis="half">{ingredients}</Box>
            <Box grow>{method}</Box>
          </Row>
        ) : (
          <>
            {ingredients}
            {method}
          </>
        )}
      </Stack>
    </Page>
  );
}
