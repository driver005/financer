// Starting points for the shop sources a phone reads, and a check before they are saved. The
// server validates again; this only saves a round trip and explains in plain words.

export const SOURCES_EXAMPLE = `[
  {
    "name": "my-shop-search",
    "shop": "My Shop",
    "kind": "search",
    "search_url": "https://shop.example/search?q={query}",
    "follow": ["/product/"],
    "max_depth": 1,
    "max_pages": 30,
    "category": "smartphone"
  },
  {
    "name": "tariff-feed",
    "shop": "Tariff Portal",
    "kind": "feed",
    "feed_url": "https://tariffs.example/feed.csv",
    "category": "mobile_plan",
    "mapping": {
      "title": "name", "price": "setup_fee", "url": "link",
      "monthly": "monthly", "min_term_months": "term",
      "promo_months": "promo_months", "promo_monthly": "promo_price", "setup": "setup_fee"
    }
  }
]`;

export type SourcesCheck = { ok: true; count: number } | { ok: false; problems: string[] };

export function checkSources(text: string): SourcesCheck {
  const t = text.trim();
  if (!t) return { ok: true, count: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch (e) {
    return { ok: false, problems: [`Not valid JSON: ${e instanceof Error ? e.message : "unreadable"}`] };
  }
  if (!Array.isArray(parsed)) return { ok: false, problems: ["The sources must be a list: [ { ... }, { ... } ]"] };
  const problems: string[] = [];
  parsed.forEach((s, i) => {
    const name = (s as { name?: unknown })?.name;
    const where = typeof name === "string" && name ? name : `source ${i + 1}`;
    if (typeof s !== "object" || s === null) return void problems.push(`${where}: not an object`);
    const o = s as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) problems.push(`${where}: needs a name`);
    const kind = (o.kind as string | undefined) ?? "pages";
    if (!["pages", "search", "feed", "sitemap"].includes(kind)) problems.push(`${where}: kind must be pages, search, feed or sitemap`);
    if (kind === "pages" && !(Array.isArray(o.urls) && o.urls.length)) problems.push(`${where}: pages need a list of urls`);
    if (kind === "search" && !(typeof o.search_url === "string" && o.search_url.includes("{query}"))) problems.push(`${where}: search_url must contain {query}`);
    if (kind === "feed" && !(typeof o.feed_url === "string" && o.mapping)) problems.push(`${where}: a feed needs feed_url and a mapping`);
    if (kind === "sitemap" && !(typeof o.sitemap_url === "string" && Array.isArray(o.follow) && o.follow.length)) problems.push(`${where}: a sitemap needs sitemap_url and follow patterns`);
  });
  return problems.length ? { ok: false, problems } : { ok: true, count: parsed.length };
}
