import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Text as RNText, View } from "react-native";

import type { Api, CatalogItem, MealShoppingList, Pantry, ShoppingItem } from "@/api/client";
import {
  Avatar,
  Badge,
  Checkbox,
  FilterChip,
  Group,
  MIN_TARGET,
  Money,
  Panel,
  RoundIcon,
  SectionLabel,
  Tap,
  radius,
  space,
  useTones,
} from "@/components/grocery/primitives";
import { ChunkyButton, HelperText, Searchbar, Text } from "@/components/kit";
import { Bar } from "@/components/ui";
import { formatCents } from "@/format";
import { chainTint, initials } from "@/groceryView";
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

/** True when the list has anything to show (a planned meal, or a meal whose recipe is gone). */
export function hasShoppingContent(list: MealShoppingList): boolean {
  return list.meals_planned > 0 || list.skipped_meals.length > 0;
}

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
    <Tap
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 56 }}
    >
      <Checkbox checked={checked} />
      <View style={{ flex: 1 }}>
        <RNText style={{ color: checked ? p.muted : p.text, fontSize: 16, fontWeight: "600", textDecorationLine: checked ? "line-through" : "none" }}>
          {title}
        </RNText>
        {detail ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{detail}</RNText> : null}
      </View>
      {price ? <Money text={price} size="md" color={checked ? p.muted : p.text} bold={!checked} /> : null}
    </Tap>
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

/** Header of a block of rows: a small label with a note under it. */
function BlockHead({ title, note }: { title: string; note?: string }) {
  const p = usePalette();
  return (
    <View style={{ marginTop: space.sm, marginBottom: space.sm }}>
      <SectionLabel>{title}</SectionLabel>
      {note ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: -space.xs }}>{note}</RNText> : null}
    </View>
  );
}

/**
 * Sticky summary of the shopping list: the budget verdict, what the week costs and how much is
 * ticked off. Put it under the scrolling list, not in it.
 */
export function ListSummaryBar({ list, ticks }: { list: MealShoppingList; ticks: readonly string[] }) {
  const p = usePalette();
  const tones = useTones();
  const verdict = budgetVerdict(list.budget);
  const progress = tickProgress(list, ticks);
  const tone = verdict.tone === "neutral" ? undefined : verdict.tone;
  const colours = tone ? tones[tone] : { fg: p.text, bg: p.surface, border: p.border };
  const icon = verdict.tone === "good" ? "check-circle" : verdict.tone === "bad" ? "alert-circle" : "information";
  const showTotal = list.budget.estimated_cents > 0 && verdict.tone !== "neutral";
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${verdict.title} ${progress.total > 0 ? `${progress.done} of ${progress.total} ticked off.` : ""}`}
      style={{
        backgroundColor: p.surface,
        borderColor: colours.border,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        marginTop: space.sm,
        marginBottom: space.sm,
        // lifts the bar off the list scrolling underneath it
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 },
        elevation: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <MaterialCommunityIcons name={icon} size={28} color={colours.fg} />
        <View style={{ flex: 1 }}>
          <RNText style={{ color: colours.fg, fontSize: 15, fontWeight: "800" }} numberOfLines={2}>
            {verdict.title}
          </RNText>
          {progress.total > 0 ? (
            <RNText style={{ color: p.muted, fontSize: 12, marginTop: 2, fontVariant: ["tabular-nums"] }}>
              {progress.done} of {progress.total} ticked off
            </RNText>
          ) : null}
        </View>
        {showTotal ? <Money text={formatCents(list.budget.estimated_cents)} size="lg" color={colours.fg} /> : null}
      </View>
      {progress.total > 0 ? <Bar progress={progress.done / progress.total} height={6} marginTop={space.sm} color={colours.fg} /> : null}
    </View>
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
  const tones = useTones();
  if (!hasShoppingContent(list)) {
    return (
      <Panel>
        <Text variant="titleMedium">Nothing to buy yet</Text>
        <Text variant="bodyMedium" style={{ color: p.muted, marginTop: space.xs }}>Plan a meal above and its ingredients show up here.</Text>
      </Panel>
    );
  }
  const verdict = budgetVerdict(list.budget);
  const tone = verdict.tone === "neutral" ? undefined : verdict.tone;
  const plan = list.plan;
  const complete = list.per_chain.filter((c) => c.complete);
  const lowest = complete.length ? Math.min(...complete.map((c) => c.total_cents)) : null;

  return (
    <View>
      <Panel tone={tone}>
        <Text variant="titleMedium" style={{ color: tone ? tones[tone].fg : p.text, fontWeight: "800" }}>{verdict.title}</Text>
        <Text variant="bodyMedium" style={{ marginTop: space.xs, color: p.text }}>{verdict.detail}</Text>
        {plan ? (
          <View
            accessible
            accessibilityLabel={planHeadline(plan)}
            style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 2, borderTopColor: tone ? tones[tone].border : p.border, gap: space.sm }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <View style={{ flex: 1 }}>
                <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>
                  {plan.split ? `Best split over ${plan.stops.length} shops` : "Cheapest shop"}
                </RNText>
                {!plan.split && plan.stops[0] ? (
                  <RNText style={{ color: p.text, fontSize: 15, marginTop: 2 }}>{chainName(plan.stops[0].chain)}</RNText>
                ) : null}
              </View>
              <Money text={formatCents(plan.total_cents)} size="xl" />
            </View>
            {plan.split && plan.saving_cents > 0 ? <Badge tone="good" icon="piggy-bank-outline" label={`${formatCents(plan.saving_cents)} cheaper than one shop`} /> : null}
          </View>
        ) : null}
      </Panel>

      {list.skipped_meals.length ? (
        <HelperText type="error" visible>
          Left out because the recipe is gone: {list.skipped_meals.join(", ")}
        </HelperText>
      ) : null}

      {list.per_chain.length > 1 ? (
        <>
          <BlockHead title="All items at one shop" />
          <Group>
            {list.per_chain.map((c) => {
              const best = c.complete && c.total_cents === lowest;
              return (
                <View
                  key={c.chain}
                  accessible
                  accessibilityLabel={chainTotalText(c)}
                  style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, paddingHorizontal: space.lg, minHeight: 56 }}
                >
                  <Avatar tint={chainTint(c.chain)} label={initials(chainName(c.chain))} size={32} />
                  <View style={{ flex: 1 }}>
                    <RNText style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{chainName(c.chain)}</RNText>
                    {!c.complete ? <RNText style={{ color: p.muted, fontSize: 12 }}>{`lacks ${c.missing.length} item${c.missing.length === 1 ? "" : "s"}`}</RNText> : null}
                  </View>
                  {best ? <Badge tone="good" label="Lowest" /> : null}
                  <Money text={formatCents(c.total_cents)} size="md" color={best ? tones.good.fg : p.text} />
                </View>
              );
            })}
          </Group>
        </>
      ) : null}

      {plan?.stops.map((stop) => {
        const ids = stop.items.map((i) => itemTickId(i.item));
        const done = ids.filter((id) => ticks.includes(id)).length;
        const all = done === ids.length && ids.length > 0;
        return (
          <View key={stop.chain}>
            <Group>
              <View
                accessibilityRole="header"
                style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, paddingHorizontal: space.lg, minHeight: MIN_TARGET + space.sm, backgroundColor: p.surfaceAlt }}
              >
                <Avatar tint={chainTint(stop.chain)} label={initials(chainName(stop.chain))} size={36} />
                <View style={{ flex: 1 }}>
                  <RNText style={{ color: p.text, fontSize: 17, fontWeight: "800" }}>{chainName(stop.chain)}</RNText>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {all ? <MaterialCommunityIcons name="check-circle" size={14} color={tones.good.fg} /> : null}
                    <RNText style={{ color: all ? tones.good.fg : p.muted, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                      {done} of {ids.length} ticked off
                    </RNText>
                  </View>
                </View>
                <Money text={formatCents(stop.subtotal_cents)} size="lg" />
              </View>
              {stop.items.map((i) => itemRow(i, ticks, onToggle))}
            </Group>
          </View>
        );
      })}

      {list.unpriced.length ? (
        <>
          <BlockHead title="No price listed" note="Not part of the total. Refresh the prices to look again." />
          <Group>{list.unpriced.map((i) => itemRow(i, ticks, onToggle))}</Group>
        </>
      ) : null}

      {list.unmatched.length ? (
        <>
          <BlockHead title="Not in the item list" note="From suggested recipes; no price, buy by the amount written." />
          <Group>
            {list.unmatched.map((u) => (
              <TickRow
                key={u.name}
                title={unmatchedText(u)}
                detail={u.meals.join(", ")}
                checked={ticks.includes(unmatchedTickId(u.name))}
                onToggle={() => onToggle(unmatchedTickId(u.name))}
              />
            ))}
          </Group>
        </>
      ) : null}

      <Panel>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <MaterialCommunityIcons name="home-outline" size={20} color={p.muted} />
          <Text variant="titleSmall">Assumed at home</Text>
        </View>
        <Text variant="bodyMedium" style={{ color: p.muted, marginVertical: space.sm }}>
          {list.pantry_skipped.length ? list.pantry_skipped.map((i) => i.name).join(", ") : "Nothing from your pantry list is needed this week."}
        </Text>
        <ChunkyButton label="Edit pantry list" icon="pot-steam-outline" outline onPress={onEditPantry} />
      </Panel>
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
    <Panel>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="titleMedium" style={{ flex: 1 }}>Pantry list</Text>
        <RoundIcon icon="close" onPress={onClose} label="Close the pantry list" />
      </View>
      <Text variant="bodySmall" style={{ color: p.muted, marginBottom: space.sm }}>
        Things you always have at home are left off the shopping list. Tap one to remove it.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md }}>
        {pantry?.items.map((i) => (
          <FilterChip key={i.item} selected icon="close" label={i.name} onPress={() => save(keys.filter((k) => k !== i.item))} accessibilityLabel={`Remove ${i.name} from the pantry list`} />
        ))}
      </View>
      <Searchbar placeholder="Add an item" accessibilityLabel="Search items to add to the pantry list" value={query} onChangeText={setQuery} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
        {matches.map((m) => (
          <FilterChip
            key={m.key}
            selected={false}
            icon="plus"
            label={m.name}
            onPress={() => {
              setQuery("");
              void save([...keys, m.key]);
            }}
            accessibilityLabel={`Add ${m.name} to the pantry list`}
          />
        ))}
      </View>
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}
    </Panel>
  );
}
