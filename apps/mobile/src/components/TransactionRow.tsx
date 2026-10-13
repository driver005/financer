import type { Transaction } from "@/api/client";
import { ListRow } from "@/components/rows";
import { Money } from "@/components/Money";
import { categoryIcon, categoryLabel } from "@/categoryIcons";
import { spokenMoney } from "@/format";

/**
 * One transaction in the spending list: category icon, counterparty, category, and the amount
 * (income in green with a plus, spending in the normal text colour with a minus). Tap to
 * recategorize or split it. Put rows inside a `ListGroup`.
 */
export function TransactionRow({ item, split, onPress }: { item: Transaction; split?: boolean; onPress: () => void }) {
  const cat = categoryIcon(item.category);
  const name = item.counterparty || "Unknown";
  return (
    <ListRow
      icon={cat.icon}
      iconTone={cat.tone}
      title={name}
      subtitle={split ? "Split" : categoryLabel(item.category)}
      titleLines={1}
      subtitleLines={1}
      value={<Money cents={item.amount_cents} variant="bodyStrong" signed />}
      chevron={false}
      onPress={onPress}
      accessibilityLabel={`${name}, ${spokenMoney(item.amount_cents)}, ${split ? "split" : categoryLabel(item.category)}. Change category or split`}
    />
  );
}
