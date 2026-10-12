import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import type { Api, CatalogItem, MealShoppingList, Pantry, ShoppingItem } from "@/api/client";
import { Chip, HelperText, Searchbar, Text } from "@/components/kit";
import { Bar, Body, Button, Card } from "@/components/ui";
import { formatCents } from "@/format";
import {
  budgetVerdict,
  chainName,
  chainTotalText,
  itemDetail,
  itemTickId,
  planHeadline,
  tickProgress,
  unmatchedText,
  unmatchedTickId,
} from "@/mealplan";
import { usePalette } from "@/theme";

/** One line of the list with a checkbox; ticking is local to the device. */
function TickRow({
  title,
  detail,
  price,
  checked,
  onToggle,
}: {
  title: string;
  detail?: string;
  price?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}
    >
      <MaterialCommunityIcons name={checked ? "checkbox-marked" : "checkbox-blank-outline"} size={26} color={checked ? p.accent : p.muted} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyLarge" style={{ textDecorationLine: checked ? "line-through" : "none", opacity: checked ? 0.55 : 1 }}>
          {title}
        </Text>
        {detail ? <Text variant="bodySmall" style={{ color: p.muted }}>{detail}</Text> : null}
      </View>
      {price ? <Text variant="bodyMedium" style={{ opacity: checked ? 0.55 : 1 }}>{price}</Text> : null}
    </Pressable>
  );
}

function itemRow(i: ShoppingItem, ticks: readonly string[], onToggle: (id: string) => void) {
  const id = itemTickId(i.item);
  return (
    <TickRow
      key={i.item}
      title={i.name}
      detail={`${itemDetail(i)}${i.is_offer ? " · offer" : ""}`}
      price={i.line_cents != null ? formatCents(i.line_cents) : undefined}
      checked={ticks.includes(id)}
      onToggle={() => onToggle(id)}
    />
  );
}

/** The week's shopping list: budget check, per-chain totals, the best split, and what has no price. */
export function ShoppingListView({
  list,
  ticks,
  onToggle,
  onEditPantry,
}: {
  list: MealShoppingList;
  ticks: readonly string[];
  onToggle: (id: string) => void;
  onEditPantry: () => void;
}) {
  const p = usePalette();
  if (list.meals_planned === 0 && list.skipped_meals.length === 0) {
    return (
      <Card>
        <Body bold>Shopping list</Body>
        <Text variant="bodyMedium" style={{ color: p.muted, marginTop: 4 }}>Plan a meal above and its ingredients show up here.</Text>
      </Card>
    );
  }
  const verdict = budgetVerdict(list.budget);
  const tone = { good: p.good, bad: p.bad, neutral: p.text }[verdict.tone];
  const progress = tickProgress(list, ticks);
  const plan = list.plan;

  return (
    <View>
      <Card>
        <Text variant="titleMedium" style={{ color: tone }}>{verdict.title}</Text>
        <Text variant="bodyMedium" style={{ color: p.muted, marginTop: 4 }}>{verdict.detail}</Text>
        {plan ? <Text variant="bodyMedium" style={{ marginTop: 8 }}>{planHeadline(plan)}</Text> : null}
        {list.per_chain.length > 1 ? (
          <View style={{ marginTop: 8 }}>
            <Text variant="bodySmall" style={{ color: p.muted }}>All items at one shop</Text>
            {list.per_chain.map((c) => (
              <Text key={c.chain} variant="bodyMedium" style={{ marginTop: 2 }}>{chainTotalText(c)}</Text>
            ))}
          </View>
        ) : null}
      </Card>

      {list.skipped_meals.length ? (
        <HelperText type="error" visible>
          Left out because the recipe is gone: {list.skipped_meals.join(", ")}
        </HelperText>
      ) : null}

      {progress.total > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Text variant="bodySmall" style={{ color: p.muted }}>{progress.done} of {progress.total} ticked off</Text>
          <Bar progress={progress.done / progress.total} />
        </View>
      ) : null}

      {plan?.stops.map((stop) => (
        <Card key={stop.chain}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text variant="titleMedium" style={{ flex: 1 }}>{chainName(stop.chain)}</Text>
            <Text variant="titleSmall">{formatCents(stop.subtotal_cents)}</Text>
          </View>
          {stop.items.map((i) => itemRow(i, ticks, onToggle))}
        </Card>
      ))}

      {list.unpriced.length ? (
        <Card>
          <Text variant="titleMedium">No price listed</Text>
          <Text variant="bodySmall" style={{ color: p.muted, marginBottom: 4 }}>Not part of the total. Refresh the prices to look again.</Text>
          {list.unpriced.map((i) => itemRow(i, ticks, onToggle))}
        </Card>
      ) : null}

      {list.unmatched.length ? (
        <Card>
          <Text variant="titleMedium">Not in the item list</Text>
          <Text variant="bodySmall" style={{ color: p.muted, marginBottom: 4 }}>From suggested recipes; no price, buy by the amount written.</Text>
          {list.unmatched.map((u) => (
            <TickRow
              key={u.name}
              title={unmatchedText(u)}
              detail={u.meals.join(", ")}
              checked={ticks.includes(unmatchedTickId(u.name))}
              onToggle={() => onToggle(unmatchedTickId(u.name))}
            />
          ))}
        </Card>
      ) : null}

      <Card>
        <Text variant="titleMedium">Assumed at home</Text>
        <Text variant="bodyMedium" style={{ color: p.muted, marginVertical: 4 }}>
          {list.pantry_skipped.length ? list.pantry_skipped.map((i) => i.name).join(", ") : "Nothing from your pantry list is needed this week."}
        </Text>
        <Button label="Edit pantry list" icon="pot-steam-outline" mode="outlined" onPress={onEditPantry} />
      </Card>
    </View>
  );
}

/** Edit the items the shopping list assumes you already have; every change is saved at once. */
export function PantryEditor({ api, onChanged, onClose }: { api: Api; onChanged: () => void; onClose: () => void }) {
  const p = usePalette();
  const [pantry, setPantry] = useState<Pantry | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.pantry(), api.catalog()])
      .then(([pa, ca]) => {
        if (!alive) return;
        setPantry(pa);
        setCatalog(ca);
      })
      .catch((e) => alive && setMessage(e instanceof Error ? e.message : "Could not load the pantry list"));
    return () => {
      alive = false;
    };
  }, [api]);

  async function save(keys: string[]) {
    setMessage(null);
    try {
      setPantry(await api.savePantry(keys));
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
  }

  const keys = pantry?.items.map((i) => i.item) ?? [];
  const q = query.trim().toLowerCase();
  const matches = q ? catalog.filter((x) => x.name.toLowerCase().includes(q) && !keys.includes(x.key)).slice(0, 6) : [];

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="titleMedium" style={{ flex: 1 }}>Pantry list</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the pantry list" hitSlop={10}>
          <MaterialCommunityIcons name="close" size={22} color={p.muted} />
        </Pressable>
      </View>
      <Text variant="bodySmall" style={{ color: p.muted, marginVertical: 4 }}>
        Things you always have at home are left off the shopping list. Tap one to remove it.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {pantry?.items.map((i) => (
          <Chip key={i.item} selected onPress={() => save(keys.filter((k) => k !== i.item))} accessibilityLabel={`Remove ${i.name} from the pantry list`}>
            {i.name}
          </Chip>
        ))}
      </View>
      <Searchbar placeholder="Add an item" accessibilityLabel="Search items to add to the pantry list" value={query} onChangeText={setQuery} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {matches.map((m) => (
          <Chip
            key={m.key}
            onPress={() => {
              setQuery("");
              void save([...keys, m.key]);
            }}
            accessibilityLabel={`Add ${m.name} to the pantry list`}
          >
            {`+ ${m.name}`}
          </Chip>
        ))}
      </View>
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}
    </Card>
  );
}
