import { useMemo, useState } from "react";
import { Badge, Box, Button, Group, IconBadge, ListItem, Note, SearchBar, Text } from "@financer/ui";

import type { Api, Idea, RecipeMatch } from "@/api/client";
import { Loading } from "@/components/Status";
import { servingsText } from "@/format";
import { initials, mealTone } from "@/groceryView";
import { entryFromIdea, entryFromRecipe, type MealEntry } from "@/mealplan";

const SHOWN = 8;

function PickRow({ title, meta, seed, onPress, label, idea }: { title: string; meta: string; seed: string; onPress: () => void; label: string; idea?: boolean }) {
  return (
    <ListItem
      leading={<IconBadge tone={mealTone(seed)} text={initials(title)} square />}
      title={title}
      subtitle={meta}
      trailing={idea ? <Badge tone="accent" label="Idea" icon="creation" /> : undefined}
      chevron={false}
      label={label}
      onPress={onPress}
    />
  );
}

/** Inline chooser for one day: search the recipes, or ask the language model for new ideas. */
export function MealPicker({ api, recipes, loading, onPick }: { api: Api; recipes: RecipeMatch[]; loading: boolean; onPick: (entry: MealEntry) => void }) {
  const [query, setQuery] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? recipes.filter((r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))) : recipes;
    return list.slice(0, SHOWN);
  }, [query, recipes]);

  async function askForIdeas() {
    setAsking(true);
    setMessage(null);
    try {
      setIdeas(await api.ideas({ count: 3 }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not get ideas");
    } finally {
      setAsking(false);
    }
  }

  return (
    <Box gap="md">
      <SearchBar placeholder="Search recipes" value={query} onChangeText={setQuery} />
      {loading && recipes.length === 0 ? <Loading rows={2} /> : null}
      {matches.length > 0 ? (
        <Group>
          {matches.map((r) => (
            <PickRow key={r.id} seed={r.id} title={r.title} meta={`${r.minutes} min · ${servingsText(r.servings)}`} label={`Plan ${r.title}`} onPress={() => onPick(entryFromRecipe(r))} />
          ))}
        </Group>
      ) : null}
      {!loading && matches.length === 0 ? <Text variant="body" tone="muted">No recipe matches.</Text> : null}
      <Button label={asking ? "Thinking…" : "Suggest new ideas"} icon="creation" onPress={askForIdeas} disabled={asking} />
      {message ? <Note tone="error">{message}</Note> : null}
      {ideas.length > 0 ? (
        <Group>
          {ideas.map((idea) => (
            <PickRow key={idea.title} idea seed={idea.title} title={idea.title} meta={`${idea.minutes} min · ${servingsText(idea.servings)}`} label={`Plan the idea ${idea.title}`} onPress={() => onPick(entryFromIdea(idea))} />
          ))}
        </Group>
      ) : null}
    </Box>
  );
}
