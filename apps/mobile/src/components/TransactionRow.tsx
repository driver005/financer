import { Box, IconBadge, ListItem, Money } from "@financer/ui";

import type { Transaction } from "@/api/client";
import { categoryIcon, categoryLabel } from "@/categoryIcons";
import { spokenMoney } from "@/format";
import { asIcon, toTone } from "@/uiTone";

/**
 * One transaction in the spending list: category icon, counterparty, category, and the amount
 * (income in green with a plus, spending in the normal text colour with a minus). Tap to
 * recategorize or split it. Put rows inside a `Group`.
 */
export function TransactionRow({ item, split, onPress }: { item: Transaction; split?: boolean; onPress: () => void }) {
  const cat = categoryIcon(item.category);
  const name = item.counterparty || "Unknown";
  return (
    <ListItem
      leading={<IconBadge icon={asIcon(cat.icon)} tone={toTone(cat.tone)} />}
      title={name}
      subtitle={split ? "Split" : categoryLabel(item.category)}
      trailing={<Box shrink={false}><Money cents={item.amount_cents} variant="bodyStrong" signed /></Box>}
      label={`${name}, ${spokenMoney(item.amount_cents)}, ${split ? "split" : categoryLabel(item.category)}. Change category or split`}
      onPress={onPress}
    />
  );
}
