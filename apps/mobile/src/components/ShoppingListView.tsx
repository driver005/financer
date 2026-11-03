import { useEffect, useState } from "react";
import { Badge, Box, Button, Card, Chip, ChipRow, Group, Icon, IconBadge, ListItem, Meter, Money, Note, Row, SearchBar, Section, Text } from "@financer/ui";

import type { Api, CatalogItem, MealShoppingList, Pantry, ShoppingItem } from "@/api/client";
import { formatCents } from "@/format";
import { chainTone, initials } from "@/groceryView";
import { budgetVerdict, chainName, chainTotalText, itemDetail, itemTickId, planHeadline, tickProgress, unmatchedText, unmatchedTickId } from "@/mealplan";

/** True when the list has anything to show (a planned meal, or a meal whose recipe is gone). */
export function hasShoppingContent(list: MealShoppingList): boolean {
  return list.meals_planned > 0 || list.skipped_meals.length > 0;
}

/** One line of the list with a checkbox; ticking is local to the device. */
function TickRow({ title, detail, price, checked, onToggle }: { title: string; detail?: string; price?: string; checked: boolean; onToggle: () => void }) {
  return (
    <ListItem
      icon={checked ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
      title={title}
      subtitle={detail}
      trailing={price ? <Text variant="number" tone={checked ? "muted" : "default"} strike={checked}>{price}</Text> : undefined}
      role="checkbox"
      checked={checked}
      label={detail ? `${title}, ${detail}` : title}
      onPress={onToggle}
    />
  );
}

function itemRow(i: ShoppingItem, ticks: readonly string[], onToggle: (id: string) => void) {
  const id = itemTickId(i.item);
  return <TickRow key={i.item} title={i.name} detail={`${itemDetail(i)}${i.is_offer ? " · offer" : ""}`} price={i.line_cents != null ? formatCents(i.line_cents) : undefined} checked={ticks.includes(id)} onToggle={() => onToggle(id)} />;
}

/**
 * Sticky summary of the shopping list: the budget verdict, what the week costs and how much is
 * ticked off. Put it in the page's footer, not in the scrolling content.
 */
export function ListSummaryBar({ list, ticks }: { list: MealShoppingList; ticks: readonly string[] }) {
  const verdict = budgetVerdict(list.budget);
  const progress = tickProgress(list, ticks);
  const tone = verdict.tone === "good" ? "success" : verdict.tone === "bad" ? "danger" : "accent";
  const icon = verdict.tone === "good" ? "check-circle" : verdict.tone === "bad" ? "alert-circle" : "information";
  const showTotal = list.budget.estimated_cents > 0 && verdict.tone !== "neutral";
  return (
    <Box bg="surface" shadow="overlay" p="lg" gap="sm" accessible accessibilityRole="summary" accessibilityLabel={`${verdict.title} ${progress.total > 0 ? `${progress.done} of ${progress.total} ticked off.` : ""}`}>
      <Row gap="md">
        <Icon name={icon} size="xl" tone={tone} />
        <Box grow>
          <Text variant="bodyStrong" numberOfLines={2}>{verdict.title}</Text>
          {progress.total > 0 ? <Text variant="caption" tone="muted">{`${progress.done} of ${progress.total} ticked off`}</Text> : null}
        </Box>
        {showTotal ? <Money cents={list.budget.estimated_cents} variant="price" tone="plain" /> : null}
      </Row>
      {progress.total > 0 ? <Meter value={progress.done / progress.total} tone={tone} /> : null}
    </Box>
  );
}

/** The week's shopping list: budget check, per-chain totals, the best split, and what has no price. */
export function ShoppingListView({ list, ticks, onToggle, onEditPantry }: { list: MealShoppingList; ticks: readonly string[]; onToggle: (id: string) => void; onEditPantry: () => void }) {
  if (!hasShoppingContent(list)) {
    return (
      <Card gap="xs">
        <Text variant="subheading">Nothing to buy yet</Text>
        <Text variant="body" tone="muted">Plan a meal above and its ingredients show up here.</Text>
      </Card>
    );
  }
  const verdict = budgetVerdict(list.budget);
  const tone = verdict.tone === "good" ? "success" : verdict.tone === "bad" ? "danger" : undefined;
  const plan = list.plan;
  const complete = list.per_chain.filter((c) => c.complete);
  const lowest = complete.length ? Math.min(...complete.map((c) => c.total_cents)) : null;

  return (
    <Box gap="lg">
      <Card tone={tone} gap="sm">
        <Text variant="subheading" tone={tone ? `on-${tone}-soft` : "default"}>{verdict.title}</Text>
        <Text variant="body" tone={tone ? `on-${tone}-soft` : "default"}>{verdict.detail}</Text>
        {plan ? (
          <Row justify="between" gap="md" accessible accessibilityLabel={planHeadline(plan)}>
            <Box grow>
              <Text variant="label" tone={tone ? `on-${tone}-soft` : "muted"}>{plan.split ? `Best split over ${plan.stops.length} shops` : "Cheapest shop"}</Text>
              {!plan.split && plan.stops[0] ? <Text variant="body" tone={tone ? `on-${tone}-soft` : "default"}>{chainName(plan.stops[0].chain)}</Text> : null}
            </Box>
            <Text variant="priceLarge" tone={tone ? `on-${tone}-soft` : "default"}>{formatCents(plan.total_cents)}</Text>
          </Row>
        ) : null}
        {plan?.split && plan.saving_cents > 0 ? <Row><Badge tone="success" icon="piggy-bank-outline" label={`${formatCents(plan.saving_cents)} cheaper than one shop`} /></Row> : null}
      </Card>

      {list.skipped_meals.length ? <Note tone="error">{`Left out because the recipe is gone: ${list.skipped_meals.join(", ")}`}</Note> : null}

      {list.per_chain.length > 1 ? (
        <Section title="All items at one shop">
          <Group>
            {list.per_chain.map((c) => {
              const best = c.complete && c.total_cents === lowest;
              return (
                <ListItem
                  key={c.chain}
                  leading={<IconBadge tone={chainTone(c.chain)} text={initials(chainName(c.chain))} />}
                  title={chainName(c.chain)}
                  subtitle={!c.complete ? `lacks ${c.missing.length} item${c.missing.length === 1 ? "" : "s"}` : undefined}
                  trailing={
                    <Row gap="sm">
                      {best ? <Badge tone="success" label="Lowest" /> : null}
                      <Text variant="number" tone={best ? "success" : "default"}>{formatCents(c.total_cents)}</Text>
                    </Row>
                  }
                  label={chainTotalText(c)}
                />
              );
            })}
          </Group>
        </Section>
      ) : null}

      {plan?.stops.map((stop) => {
        const ids = stop.items.map((i) => itemTickId(i.item));
        const done = ids.filter((id) => ticks.includes(id)).length;
        const all = done === ids.length && ids.length > 0;
        return (
          <Group key={stop.chain}>
            <ListItem
              leading={<IconBadge tone={chainTone(stop.chain)} text={initials(chainName(stop.chain))} />}
              title={chainName(stop.chain)}
              subtitle={`${done} of ${ids.length} ticked off`}
              trailing={
                <Row gap="sm">
                  {all ? <Icon name="check-circle" size="md" tone="success" /> : null}
                  <Text variant="price">{formatCents(stop.subtotal_cents)}</Text>
                </Row>
              }
            />
            {stop.items.map((i) => itemRow(i, ticks, onToggle))}
          </Group>
        );
      })}

      {list.unpriced.length ? (
        <Section title="No price listed" description="Not part of the total. Refresh the prices to look again.">
          <Group>{list.unpriced.map((i) => itemRow(i, ticks, onToggle))}</Group>
        </Section>
      ) : null}

      {list.unmatched.length ? (
        <Section title="Not in the item list" description="From suggested recipes; no price, buy by the amount written.">
          <Group>
            {list.unmatched.map((u) => (
              <TickRow key={u.name} title={unmatchedText(u)} detail={u.meals.join(", ")} checked={ticks.includes(unmatchedTickId(u.name))} onToggle={() => onToggle(unmatchedTickId(u.name))} />
            ))}
          </Group>
        </Section>
      ) : null}

      <Card gap="sm">
        <Row gap="sm">
          <Icon name="home-outline" size="md" tone="muted" />
          <Text variant="bodyStrong">Assumed at home</Text>
        </Row>
        <Text variant="label" tone="muted">{list.pantry_skipped.length ? list.pantry_skipped.map((i) => i.name).join(", ") : "Nothing from your pantry list is needed this week."}</Text>
        <Button label="Edit pantry list" icon="pot-steam-outline" variant="outline" onPress={onEditPantry} />
      </Card>
    </Box>
  );
}

/** Edit the items the shopping list assumes you already have; every change is saved at once. */
export function PantryEditor({ api, onChanged, onClose }: { api: Api; onChanged: () => void; onClose: () => void }) {
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
    <Box gap="md">
      <Text variant="caption" tone="muted">Things you always have at home are left off the shopping list. Tap one to remove it.</Text>
      <ChipRow>
        {pantry?.items.map((i) => (
          <Chip key={i.item} selected label={i.name} onRemove={() => save(keys.filter((k) => k !== i.item))} />
        ))}
      </ChipRow>
      <SearchBar placeholder="Add an item" value={query} onChangeText={setQuery} />
      <ChipRow>
        {matches.map((m) => (
          <Chip
            key={m.key}
            icon="plus"
            label={m.name}
            onPress={() => {
              setQuery("");
              void save([...keys, m.key]);
            }}
          />
        ))}
      </ChipRow>
      {message ? <Note tone="error">{message}</Note> : null}
      <Button label="Done" variant="ghost" onPress={onClose} />
    </Box>
  );
}
