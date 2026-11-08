import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Badge, Box, Card, Chip, ChipRow, HeroCaption, HeroCard, HeroChip, HeroNumber, IconBadge, IconButton, Icon, Note, ProgressRing, Row, Text, TextField, VirtualList } from "@financer/ui";

import type { Idea, RecipeMatch } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { SectionSwitch } from "@/components/SectionSwitch";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { formatCents, parseEuroInput, servingsText } from "@/format";
import { costPerServing, initials, mealTone, shortList } from "@/groceryView";
import { useScreenData } from "@/hooks";
import { IDEA_ID, stashIdea } from "@/recipeStash";

const TAGS = ["vegetarisch", "vegan", "günstig", "schnell", "fleisch", "fisch"];

export default function Recipes() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const [tag, setTag] = useState<string | undefined>();
  const [budgetText, setBudgetText] = useState("");
  const budget = budgetText.trim() ? parseEuroInput(budgetText) : null;

  const { data, error, busy } = useScreenData(useCallback((a) => a.recipes({ tag, budgetCents: budget ?? undefined, limit: 20 }), [tag, budget]));
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

  if (!loaded) return <Page title="Recipes"><Loading /></Page>;
  if (!api) return <Page title="Recipes"><SectionSwitch /><NeedsSetup /></Page>;

  const loading = busy && !data;

  return (
    <Page
      title="Recipes"
      fixed
      actions={
        <>
          <IconButton icon="calendar-week" label="Plan my week" onPress={() => router.push("/mealplan")} />
          <IconButton icon="creation" label={asking ? "Thinking of ideas" : "Surprise me with new ideas"} onPress={askForIdeas} disabled={asking} />
        </>
      }
    >
      <VirtualList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        gap="md"
        header={
          <Box gap="md">
            <SectionSwitch />
            {data && data.length > 0 ? (
              <HeroCard label="Recipes for you" chip={tag ? <HeroChip icon="filter-variant" text={tag} /> : null}>
                <HeroNumber value={`${data.length}`} suffix={data.length === 1 ? "recipe" : "recipes"} />
                <HeroCaption>Matched against your usual items and today's prices.</HeroCaption>
              </HeroCard>
            ) : null}
            <ChipRow>
              <Chip label="All" selected={!tag} onPress={() => setTag(undefined)} />
              {TAGS.map((t) => (
                <Chip key={t} label={t} selected={tag === t} onPress={() => setTag(tag === t ? undefined : t)} />
              ))}
            </ChipRow>
            <TextField
              label="Max. cost of missing ingredients"
              value={budgetText}
              onChangeText={setBudgetText}
              keyboardType="decimal-pad"
              right={<Text variant="label" tone="muted">€</Text>}
              error={budgetText.trim() !== "" && budget === null ? "Enter an amount like 5 or 5,50." : undefined}
            />
            {ideaMessage ? <Note tone="error">{ideaMessage}</Note> : null}
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.title}
                idea={idea}
                onOpen={() => {
                  stashIdea(idea);
                  router.push({ pathname: "/recipe", params: { id: IDEA_ID } });
                }}
              />
            ))}
            {error ? <Note tone="error">{error}</Note> : null}
            {loading ? <Loading rows={3} /> : null}
          </Box>
        }
        empty={
          busy ? undefined : (
            <Empty
              mood="worried"
              title="No recipe fits these filters"
              message="Try another diet or a higher limit for the missing ingredients."
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
        renderItem={(item, index) => <RecipeCard recipe={item} best={index === 0} onOpen={() => router.push({ pathname: "/recipe", params: { id: item.id } })} />}
      />
    </Page>
  );
}

function Meta({ icon, text }: { icon: "clock-outline" | "account-multiple-outline"; text: string }) {
  return (
    <Row gap="xs">
      <Icon name={icon} size="sm" tone="muted" />
      <Text variant="caption" tone="muted">{text}</Text>
    </Row>
  );
}

function RecipeCard({ recipe: r, best, onOpen }: { recipe: RecipeMatch; best: boolean; onOpen: () => void }) {
  const names = new Map(r.ingredients.map((i) => [i.item, i.name]));
  const nameOf = (k: string) => names.get(k) ?? k;
  const perServing = costPerServing(r);
  const missing = shortList(r.missing.map((k) => nameOf(k) + (r.unpriced.includes(k) ? " (no price yet)" : "")), 2);
  const offers = shortList(r.on_offer.map(nameOf), 2);
  return (
    <Card gap="md" onPress={onOpen} label={`Open recipe ${r.title}`}>
      <Row gap="md">
        <IconBadge tone={mealTone(r.id)} text={initials(r.title)} square />
        <Box grow gap="2xs">
          {best ? <Row><Badge tone="success" label="Best match" icon="star" /></Row> : null}
          <Text variant="subheading" level={3}>{r.title}</Text>
          <Row gap="md" wrap>
            <Meta icon="clock-outline" text={`${r.minutes} min`} />
            <Meta icon="account-multiple-outline" text={servingsText(r.servings)} />
          </Row>
        </Box>
        <ProgressRing progress={r.coverage_percent / 100} box="md" stroke="lg" label={`You already buy ${r.coverage_percent} percent of the ingredients`}>
          <Text variant="number">{`${r.coverage_percent}%`}</Text>
        </ProgressRing>
      </Row>

      {r.tags.length > 0 ? (
        <Row gap="sm" wrap>
          {r.tags.map((t) => (
            <Badge key={t} label={t} />
          ))}
        </Row>
      ) : null}

      <Row gap="sm" wrap>
        {perServing !== null ? (
          <>
            <Text variant="price">{perServing === 0 ? "no price yet" : formatCents(perServing)}</Text>
            {perServing !== 0 ? <Text variant="label" tone="muted">to buy per serving</Text> : null}
          </>
        ) : (
          <Badge tone="success" label="Nothing to buy" icon="check-circle-outline" />
        )}
      </Row>

      {r.missing.length ? (
        <Text variant="label">
          {`Missing: ${missing.shown.join(", ")}${missing.more ? ` +${missing.more} more` : ""}${r.missing_cost_cents > 0 ? ` · about ${formatCents(r.missing_cost_cents)} in all for the priced ones` : ""}`}
        </Text>
      ) : null}

      {r.on_offer.length ? (
        <Row gap="sm" wrap>
          {offers.shown.map((n) => (
            <Badge key={n} tone="warning" label={`On offer: ${n}`} icon="tag" />
          ))}
          {offers.more ? <Badge tone="warning" label={`+${offers.more}`} /> : null}
        </Row>
      ) : null}

      <Row gap="xs" justify="end">
        <Text variant="label" tone="accent">Open recipe</Text>
        <Icon name="chevron-right" size="sm" tone="accent" />
      </Row>
    </Card>
  );
}

function IdeaCard({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  return (
    <Card tone="accent" gap="md" onPress={onOpen} label={`Open idea ${idea.title}`}>
      <Row gap="md">
        <IconBadge tone={mealTone(idea.title)} text={initials(idea.title)} square />
        <Box grow gap="2xs">
          <Row><Badge tone="accent" label="New idea" icon="creation" /></Row>
          <Text variant="subheading" level={3}>{idea.title}</Text>
        </Box>
      </Row>
      <Text variant="label">{idea.summary}</Text>
      <Row gap="md">
        <Meta icon="clock-outline" text={`${idea.minutes} min`} />
        <Meta icon="account-multiple-outline" text={servingsText(idea.servings)} />
      </Row>
      <Row gap="xs" justify="end">
        <Text variant="label" tone="accent">Open recipe</Text>
        <Icon name="chevron-right" size="sm" tone="accent" />
      </Row>
    </Card>
  );
}
