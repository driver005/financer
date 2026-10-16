// Which bottom tab a screen belongs to, and the switcher shown at the top of related screens.
// Plain data and functions (no React Native), so a test can check that every screen has a home.
//
// Four tabs instead of six: Money (Spending and Budget), Groceries (Prices, Recipes, Meal plan,
// Usual items), Today and Settings. Every other screen is still its own route (links and
// notifications keep working) and counts as part of the tab it is reached from.

export type TabId = "today" | "money" | "groceries" | "settings";

export type TabDef = { id: TabId; title: string; icon: string; href: string; screens: readonly string[] };

export const TABS: readonly TabDef[] = [
  { id: "today", title: "Today", icon: "home-variant", href: "/", screens: ["/", "/trophies"] },
  { id: "money", title: "Money", icon: "swap-vertical", href: "/spending", screens: ["/spending", "/budget", "/sync", "/rules", "/subscriptions", "/alerts", "/stores"] },
  { id: "groceries", title: "Groceries", icon: "cart-outline", href: "/prices", screens: ["/prices", "/recipes", "/mealplan", "/basket", "/receipts", "/receipt-sources", "/scan"] },
  { id: "settings", title: "Settings", icon: "cog-outline", href: "/settings", screens: ["/settings"] },
];

export type SwitchItem = { label: string; href: string };

/** The switcher at the top of the screens that share a tab. */
export const SWITCHES: Partial<Record<TabId, readonly SwitchItem[]>> = {
  money: [
    { label: "Spending", href: "/spending" },
    { label: "Budget", href: "/budget" },
  ],
  groceries: [
    { label: "Prices", href: "/prices" },
    { label: "Recipes", href: "/recipes" },
    { label: "Plan", href: "/mealplan" },
    { label: "Items", href: "/basket" },
  ],
};

/** The tab a path belongs to. Unknown paths count as Today. */
export function tabFor(pathname: string): TabId {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TABS.find((t) => t.screens.includes(path))?.id ?? "today";
}

/** The switcher items and the active one for a path, or null on screens without a switcher. */
export function switchFor(pathname: string): { items: readonly SwitchItem[]; active: string } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const items = SWITCHES[tabFor(path)];
  if (!items || !items.some((i) => i.href === path)) return null;
  return { items, active: path };
}

/** Routes with no tab bar at all. */
export const BARE_SCREENS: readonly string[] = ["/onboarding"];
