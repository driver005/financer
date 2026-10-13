/** Icon (a MaterialCommunityIcons name) and colour role for a transaction category. Pure data. */

export type CategoryTone = "accent" | "good" | "bad" | "warn" | "blue" | "gold";

const ICONS: Record<string, { icon: string; tone: CategoryTone }> = {
  groceries: { icon: "cart-outline", tone: "good" },
  dining: { icon: "silverware-fork-knife", tone: "warn" },
  transport: { icon: "train", tone: "blue" },
  housing: { icon: "home-outline", tone: "accent" },
  utilities: { icon: "flash-outline", tone: "gold" },
  insurance: { icon: "shield-check-outline", tone: "blue" },
  subscriptions: { icon: "calendar-sync-outline", tone: "accent" },
  health: { icon: "heart-pulse", tone: "bad" },
  leisure: { icon: "party-popper", tone: "warn" },
  shopping: { icon: "shopping-outline", tone: "accent" },
  cash: { icon: "cash", tone: "good" },
  savings: { icon: "piggy-bank-outline", tone: "good" },
  income: { icon: "cash-plus", tone: "good" },
  other: { icon: "tag-outline", tone: "accent" },
};

/** Falls back to a generic tag for an unknown or missing category. */
export function categoryIcon(category: string | null | undefined): { icon: string; tone: CategoryTone } {
  return (category && ICONS[category]) || { icon: "tag-outline", tone: "accent" };
}

/** `groceries` -> `Groceries`; missing -> `Uncategorized`. */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "Uncategorized";
  return category.charAt(0).toUpperCase() + category.slice(1);
}
