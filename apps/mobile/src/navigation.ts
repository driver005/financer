// Which bottom tab a screen belongs to, and the switcher shown at the top of related screens.
// Plain data and functions (no React Native), so a test can check that every screen has a home.
//
// Four tabs instead of six: Money (Spending and Budget), Groceries (Prices, Recipes, Meal plan,
// Usual items), Today and Settings. Every other screen is still its own route (links and
// notifications keep working) and counts as part of the tab it is reached from.

export type TabId = "today" | "money" | "groceries";

export type TabDef = { id: TabId; title: string; icon: string; href: string; screens: readonly string[] };

/** The bottom bar: the three things you use every day. Settings is a button at the top right. */
export const TABS: readonly TabDef[] = [
  { id: "today", title: "Today", icon: "home-variant", href: "/", screens: ["/", "/trophies"] },
  { id: "money", title: "Money", icon: "swap-vertical", href: "/spending", screens: ["/spending", "/budget", "/stores"] },
  { id: "groceries", title: "Groceries", icon: "cart-outline", href: "/prices", screens: ["/prices", "/recipes", "/mealplan", "/basket"] },
];

/**
 * Settings and everything opened from it (bank sync, rules, receipts, ...): a separate area with
 * no tab bar, a back button and a grey page, so it is clear you have left the everyday screens.
 */
export const SETTINGS_SCREENS: readonly string[] = ["/settings", "/sync", "/rules", "/subscriptions", "/alerts", "/receipts", "/receipt-sources", "/scan"];

/** Routes with no chrome at all (first-run setup). */
export const BARE_SCREENS: readonly string[] = ["/onboarding"];

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

function clean(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export type Area = "tab" | "settings" | "bare";

/** Which part of the app a path is in. Unknown paths count as an everyday screen. */
export function areaFor(pathname: string): Area {
  const path = clean(pathname);
  if (BARE_SCREENS.includes(path)) return "bare";
  if (SETTINGS_SCREENS.includes(path)) return "settings";
  return "tab";
}

/** The tab a path belongs to, or null in the settings area and on bare screens. Unknown paths count as Today. */
export function tabFor(pathname: string): TabId | null {
  if (areaFor(pathname) !== "tab") return null;
  const path = clean(pathname);
  return TABS.find((t) => t.screens.includes(path))?.id ?? "today";
}

/** The switcher items and the active one for a path, or null on screens without a switcher. */
export function switchFor(pathname: string): { items: readonly SwitchItem[]; active: string } | null {
  const path = clean(pathname);
  const tab = tabFor(path);
  const items = tab ? SWITCHES[tab] : undefined;
  if (!items || !items.some((i) => i.href === path)) return null;
  return { items, active: path };
}
