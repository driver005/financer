import { Box, IconBadge, ListItem, Money } from "@financer/ui";

import type { Transaction } from "@/api/client";
import { categoryIcon, categoryLabel } from "@/categoryIcons";
import { spokenMoney } from "@/format";
import { shortDate } from "@/mealplan";
import { asIcon } from "@/uiTone";

/**
 * One booking as PocketPilot draws it: a round pale-green tile with the category's icon, the
 * counterparty, "Category · date" under it, and the amount at the end (income in green with a plus).
 * The tile is the same green for every category, so the list reads as one calm column. Tap to
 * recategorize or split it. Put rows inside an inset `Group`.
 */
export function TransactionRow({ item, split, onPress }: { item: Transaction; split?: boolean; onPress: () => void }) {
  const cat = categoryIcon(item.category);
  const name = item.counterparty || "Unknown";
  const what = split ? "Split" : categoryLabel(item.category);
  return (
    <ListItem
      leading={<IconBadge icon={asIcon(cat.icon)} tone="success" />}
      title={name}
      subtitle={`${what} · ${shortDate(item.booking_date)}`}
      trailing={<Box shrink={false}><Money cents={item.amount_cents} variant="bodyStrong" signed /></Box>}
      label={`${name}, ${spokenMoney(item.amount_cents)}, ${what}, ${shortDate(item.booking_date)}. Change category or split`}
      onPress={onPress}
    />
  );
}
