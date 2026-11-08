/**
 * What the one search of the app can find: the pages (and what each is for), and, once it opens, the
 * bookings, calendar events, recipes, prices and mail chats of the person. The ranking is one rule in
 * Rust (crates/logic, search.rs); this file only says what there is and where each thing leads.
 */
import type { Api, Price, RecipeMatch, Transaction, CalendarEvent } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";
import { categoryLabel } from "./categoryIcons";
import { formatCents } from "./format";
import { shortDate } from "./mealplan";

export type SearchKind = "page" | "booking" | "event" | "recipe" | "price" | "chat";

export type Href = { pathname: string; params?: Record<string, string> };

export type SearchEntry = { kind: SearchKind; title: string; subtitle: string; keywords: string; href: Href };

export const KIND_LABEL: Record<SearchKind, string> = { page: "Pages", booking: "Bookings", event: "Events", recipe: "Recipes", price: "Prices", chat: "Mail" };
export const KIND_ORDER: readonly SearchKind[] = ["page", "booking", "chat", "event", "recipe", "price"];

/** Every screen of the app with a few words that people use for it (the route files are checked against this in the tests). */
export const PAGES: readonly { path: string; title: string; subtitle: string; keywords: string }[] = [
  { path: "/", title: "Today", subtitle: "Your day at a glance", keywords: "home overview daily safe to spend forecast" },
  { path: "/spending", title: "Spending", subtitle: "Transactions, filters and search", keywords: "transactions bookings expenses income money bank statement" },
  { path: "/budget", title: "Budget", subtitle: "Envelopes and what is left", keywords: "envelopes limit left month payday" },
  { path: "/stores", title: "Spending by store", subtitle: "Where you shop", keywords: "stores shops chains supermarket" },
  { path: "/trophies", title: "Trophies", subtitle: "Badges you earned", keywords: "badges achievements streak game" },
  { path: "/mail", title: "Mail", subtitle: "Chats by person and topic", keywords: "email inbox messages compose chat" },
  { path: "/calendar", title: "Calendar", subtitle: "Events and reminders", keywords: "events agenda schedule month week day appointments" },
  { path: "/prices", title: "Prices", subtitle: "Compare shops", keywords: "groceries offers deals cheapest supermarket" },
  { path: "/recipes", title: "Recipes", subtitle: "What to cook with what you buy", keywords: "cooking meals food kochen rezepte" },
  { path: "/mealplan", title: "Meal plan", subtitle: "Plan the week and shop for it", keywords: "week shopping list pantry menu" },
  { path: "/basket", title: "Usual items", subtitle: "What you buy most often", keywords: "basket groceries habits" },
  { path: "/settings", title: "Settings", subtitle: "Everything you can change", keywords: "preferences options account privacy lock backup notifications theme" },
  { path: "/sync", title: "Bank sync", subtitle: "Sparkasse over FinTS", keywords: "bank connection fints import transactions" },
  { path: "/rules", title: "Categorization rules", subtitle: "Match merchants to categories", keywords: "categories merchants rules" },
  { path: "/subscriptions", title: "Subscriptions", subtitle: "Recurring payments and price increases", keywords: "recurring monthly netflix abo cancel" },
  { path: "/alerts", title: "Alerts", subtitle: "Payments that look odd", keywords: "warnings duplicates price hike watchdog" },
  { path: "/receipts", title: "Receipts", subtitle: "Add and read receipts", keywords: "scan upload bon kassenzettel" },
  { path: "/receipt-sources", title: "Receipt sources", subtitle: "Mailbox, Lidl Plus and a watched folder", keywords: "lidl kaufland rewe email import" },
  { path: "/rewe-sync", title: "REWE receipts", subtitle: "Sign in to REWE", keywords: "rewe ebon" },
  { path: "/orders-import", title: "Online orders", subtitle: "Import an order history", keywords: "amazon csv export orders" },
  { path: "/share", title: "Shared with Financer", subtitle: "Files and text from other apps", keywords: "share intent import" },
  { path: "/scan", title: "Scan a product", subtitle: "Barcode and price", keywords: "barcode ean camera" },
  { path: "/server-config", title: "Server settings", subtitle: "The server's configuration", keywords: "server config bank providers gocardless plaid finapi token url" },
];

export function pageEntries(): SearchEntry[] {
  return PAGES.map((p) => ({ kind: "page", title: p.title, subtitle: p.subtitle, keywords: p.keywords, href: { pathname: p.path } }));
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

export const bookingEntry = (t: Transaction): SearchEntry => ({
  kind: "booking",
  title: clean(t.counterparty) || "Unknown",
  subtitle: `${categoryLabel(t.category)} · ${shortDate(t.booking_date)} · ${formatCents(t.amount_cents)}`,
  keywords: `${clean(t.purpose)} ${clean(t.category)}`,
  href: { pathname: "/spending", params: { q: clean(t.counterparty) } },
});

export const eventEntry = (e: CalendarEvent): SearchEntry => ({
  kind: "event",
  title: e.title,
  subtitle: `${shortDate(e.start_date)}${e.start_time ? ` ${e.start_time}` : ""}${e.location ? ` · ${e.location}` : ""}`,
  keywords: `${clean(e.notes)} ${clean(e.location)}`,
  href: { pathname: "/calendar", params: { date: e.start_date } },
});

export const recipeEntry = (r: RecipeMatch): SearchEntry => ({
  kind: "recipe",
  title: r.title,
  subtitle: `${r.minutes} min · ${r.tags.join(", ")}`,
  keywords: `${r.ingredients.map((i) => i.name).join(" ")} ${r.tags.join(" ")}`,
  href: { pathname: "/recipes" },
});

/** One entry per product, at its cheapest chain. */
export function priceEntries(prices: Price[]): SearchEntry[] {
  const best = new Map<string, Price>();
  for (const p of prices) {
    const have = best.get(p.item);
    if (!have || p.price_cents < have.price_cents) best.set(p.item, p);
  }
  return [...best.values()].map((p) => ({
    kind: "price" as const,
    title: p.item_name,
    subtitle: `${formatCents(p.price_cents)} per ${p.reference_pack} · ${p.chain}`,
    keywords: `${p.product_name} ${p.chain}`,
    href: { pathname: "/prices" },
  }));
}

export type MailChat = { key: string; title: string; preview: string; topics: string[] };
export const chatEntry = (c: MailChat): SearchEntry => ({
  kind: "chat",
  title: c.title,
  subtitle: c.topics[0] ? `${c.topics[0]} · ${c.preview}` : c.preview,
  keywords: c.topics.join(" "),
  href: { pathname: "/mail" },
});

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The person's own things, each source on its own: one that fails (no mail server, say) leaves the rest. */
export async function loadEntries(api: Api, mail: () => Promise<MailChat[]>): Promise<SearchEntry[]> {
  const now = new Date();
  const from = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  const to = day(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const [bookings, events, recipes, prices, chats] = await Promise.all([
    api.transactions().then((l) => l.map(bookingEntry)).catch(() => []),
    api.calendarEvents(from, to).then((l) => l.map(eventEntry)).catch(() => []),
    api.recipes({ limit: 50 }).then((l) => l.map(recipeEntry)).catch(() => []),
    api.prices().then(priceEntries).catch(() => []),
    mail().then((l) => l.map(chatEntry)).catch(() => []),
  ]);
  return [...bookings, ...events, ...recipes, ...prices, ...chats];
}

/** The entries that match `query`, best first (the ranking is in Rust). */
export function searchEntries(entries: SearchEntry[], query: string, limitPerKind = 6, limit = 40): SearchEntry[] {
  if (query.trim() === "") return [];
  const hits = logic<{ index: number; score: number }[]>("search.rank", {
    entries: entries.map(({ kind, title, subtitle, keywords }) => ({ kind, title, subtitle, keywords })),
    query,
    limit_per_kind: limitPerKind,
    limit,
  });
  return hits.map((h) => entries[h.index]);
}
