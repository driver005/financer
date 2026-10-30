# The shopping assistant

A second app in this repository. It finds products and subscriptions on the web, reads their prices
and specs, and ranks them by what matters to **you**: for a phone that is price, which price class it
falls into, the deal, camera, battery, software updates, ecosystem and more. Every criterion and
every spec is data you can extend; nothing about "phones" is hard-coded.

## One project, several apps

| You want | Build | What you get |
|---|---|---|
| Finance only (as before) | `apps/mobile` as is, `financer-server` as is | nothing of the shop is bundled |
| Shopping only | `apps/shopping`, `financer-shop-server` | a small app and server of its own, with its own database |
| Both in one app | `apps/mobile` with `EXPO_PUBLIC_SHOPPING=1`, `financer-server --features shop` | the shop appears under Settings > Groceries; one server, one token, `/v1/shop` beside the finance API |

```
crates/shop-core      products, offers, plans, category schemas and criteria, formulas, ranking,
                      deals, price tiers, search index. No I/O.
crates/shop-sources   page, feed and sitemap readers; the crawler (on demand and continuous)
crates/shop-store     own tables and migrations (SQLite and PostgreSQL)
crates/shop-api       the /v1/shop router, index jobs with progress, watches, notifications
crates/shop-server    the standalone server (`financer-shop-server`)
crates/embedded       `ShopBackend`: the same router in-process on the phone (feature `shop`, on by default)
packages/shopping     the app as a module: client, scoring helpers, notification logic, screens
apps/shopping         a thin Expo app around the module
apps/mobile           the finance app; carries the module when built with EXPO_PUBLIC_SHOPPING=1
```

The two apps share nothing at runtime except what a build puts together: the shop has its own
tables (its own migration history, so it can sit in the finance PostgreSQL database or in a file of
its own), its own screens and its own server. Removing it is not a code change.

## Two ways to run: integrated and server

|  | Integrated (on the phone) | Server |
|---|---|---|
| Searching | **only when you press Search.** The press builds an index for that search: it reads your shops, files products and prices, then ranks. Nothing is read in the background. | **all the time**, like a small search engine: it keeps a frontier of pages, revisits them on a schedule, and keeps price history |
| Progress | a progress bar in the app **and in a notification** | the same, when you press "Refresh now" |
| Deals | found when you search; shown as notifications while the app is open | watched continuously; pushed through ntfy, the app's push or a webhook, even when the app is closed |
| Data | on the phone, in its own SQLite file | on the server |
| Limits | a phone cannot watch while the app is closed (iOS suspends apps; see [EMBEDDED.md](EMBEDDED.md)) | needs a machine that runs |

The server mode is `FINANCER_SHOP_CRAWL=true` (the default for the servers). With it `false` the same
server behaves like the phone: nothing is read until someone searches. The apps ask `/v1/shop/info`
which mode they talk to and adjust their words and buttons.

### The progress notification

`ProgressModel` (packages/shopping/src/logic/progress.ts) turns an index job into a title, a body and
a percentage; `followJob` polls the job and hands the model to a *surface*.

* **Android with `@notifee/react-native`** (a dependency of `apps/shopping`; optional in `apps/mobile`):
  a real determinate progress bar in the notification, and a foreground service so the run continues
  while you leave the app. `plugins/withIndexService.js` declares the `dataSync` service type Android 14
  needs.
* **Everything else** (iOS, Expo Go, a build without Notifee): a sticky notification re-posted under one
  id whose text carries a bar made of blocks: `▰▰▰▱▱▱▱▱▱▱ 30 %`. iOS has no progress-bar notification
  short of Live Activities, which this does not use.

To get the real bar in the finance app too: `npm install @notifee/react-native@9.1.8` in `apps/mobile`
and rebuild the native app.

## How a result is ranked

For the products found by the search (or all of a category) every **criterion** of the category is
computed and turned into a score between 0 and 1; the weighted mean of the known scores, times 100,
is the product's score.

* **Scales.** `fixed` (3000 mAh is 0, 6500 mAh is 1: stable whatever else is in the list), `minmax`,
  or `percentile`; optional `log` (storage 64 to 1024 GB is four doublings, not 960 GB).
* **Missing data** lowers the *confidence* (shown as "Some specs unknown") instead of counting as
  zero; a criterion can instead say `neutral` or `worst`.
* **Price tiers**: budget, mid-range, upper mid-range, flagship are the quartiles of everything known
  in the category (not only the search result), so a filter does not move the bands.
* **Quality** is the score without the price and deal criteria. **Value index** is quality divided
  by the square root of the price relative to the category median: twice the price has to buy about 41 %
  more quality. The *picks* are best overall, best value, cheapest of the better half and premium.
  A product is on the *efficient frontier* when nothing is both cheaper and better.
* **Wishes** (ecosystem, preferred network) are criteria of kind `match`. They only exist for a person
  who states a wish; a phone in the Apple ecosystem is 1, an avoided one 0, anything else 0.4.
* **Deals** compare the current price with the *median of the last 90 days of our own price history*
  (not the shop's struck-through "was" price, which is often inflated). With too little history the
  list price is used and the verdict is capped at "good".
* Every result explains itself: per-criterion points that add up to the score, strengths, weaknesses.

## Extending it: categories, attributes, criteria, formulas

A category is JSON (examples in `crates/shop-core/builtin/`). It can `extend` another one and add,
replace or `remove` its attributes and criteria. In the app: More > Categories, or the JSON editor;
over the API: `PUT /v1/shop/categories/{id}`, validated before it is stored.

```json
{
  "id": "gaming_phone", "name": "Gaming phone", "extends": "smartphone",
  "keywords": ["gaming phone"],
  "attributes": [
    { "key": "shoulder_triggers", "label": "Shoulder triggers", "kind": "bool", "aliases": ["Schultertasten"] }
  ],
  "criteria": [
    { "key": "triggers", "label": "Shoulder triggers", "kind": "flag", "attribute": "shoulder_triggers", "weight": 3 },
    { "key": "battery", "label": "Battery", "kind": "number", "attribute": "battery_mah", "weight": 4,
      "scale": { "type": "fixed", "min": 4000, "max": 8000 } },
    { "key": "grip", "label": "Battery per gram", "kind": "formula", "expr": "battery_mah / weight_g",
      "weight": 1, "scale": { "type": "fixed", "min": 20, "max": 40 } }
  ]
}
```

* **Attributes** carry `aliases` (the labels shop pages use, in any language), `units` (`{"tb": 1000}`
  converts "1 TB" to 1000 GB) and `words` (`{"unbegrenzt": 1000}` reads "unlimited" as a number). The
  crawler files every spec it finds under the attribute whose name or alias matches; the labels nobody
  claimed are reported after each index run, so you see what the category is missing.
* **Derived attributes** (`derive`) fill a missing one from others: an `os` containing "android" adds
  `android` to `ecosystem`.
* **Criterion kinds**: `number`, `choice` (text to score), `flag`, `match` (a wish), `age` (newness with
  a half-life), `formula`, `price`, `deal`.
* **Formulas** are a small arithmetic language: numbers, attribute names, `+ - * / ^`, brackets and
  `min max abs sqrt ln log10 clamp coalesce`. `price`, `monthly`, `upfront` and `term_months` come from the
  best offer. A missing attribute makes the result missing (except inside `coalesce`).
* **Per search**: a profile can carry `extra_criteria`, and `weights` per criterion (the app's
  "What matters" screen sets them; presets such as "Camera first" are generated from the criteria's
  `group`, so a new group gets its preset without code).
* **Per product**: you can add or correct any spec (`PUT /v1/shop/products/{id}`); crawls never
  overwrite it. Any key works; keys the category knows are used by its criteria.

The query language understands plain words, a price ("unter 500 €", `under 1.200 eur`, `<500`), and
attribute conditions (`ram_gb>=8 battery_mah>4500 brand:google nfc:yes`) with typo tolerance.

## Subscriptions

Phone plans, home internet and streaming are categories of kind `subscription`. An offer has an upfront
price and a `recurring` part (monthly price, minimum term, promotional months, setup fee, cash back).
Plans are compared by the **effective monthly cost over the longer of your horizon (24 months) and the
contract term**: a plan that is free for 6 months but has a setup fee and a 24-month term is priced
for what it really costs. A phone with a contract is the same thing with an upfront price.
"What you pay now" (`PUT /v1/shop/my/{category}`) makes every result show the saving per month and over
the term. Add your own subscription categories (gym, insurance) the same way as any category.

## Where the data comes from

You configure sources; there are no per-shop scrapers (like the grocery prices, see [PRICES.md](PRICES.md)).

| `kind` | Reads |
|---|---|
| `pages` | product pages or listings at fixed `urls` |
| `search` | a shop's search (`search_url` with `{query}`), following result links (`follow`, `max_depth`) |
| `feed` | a CSV or JSON product feed with a column `mapping`: the dependable way for big catalogs and tariff lists |
| `sitemap` | the product URLs of a shop, crawled over time (server only) |

Pages are read through schema.org JSON-LD (`Product`, `Offer`, `AggregateOffer`, `ItemList`,
`additionalProperty`, monthly `UnitPriceSpecification` for plans) plus the specification tables
(`<table>`, `<dl>`) of the same page. `use_llm: true` lets a configured Claude/OpenAI model read a page
without structured data; the price must literally appear in the page text. All reading goes through the
same polite HTTP client as the grocery prices: it identifies itself, obeys robots.txt and waits between
requests. Reading shop pages may breach their terms; this is for personal use on sources you choose.

Same product on two shops is one product: matched by GTIN/EAN when a page has one, otherwise by brand
and title with colours and filler words removed ("Pixel 9 Obsidian" and "Pixel 9 schwarz"). Sizes stay
(128 GB and 256 GB are different products). This is a heuristic and will sometimes split or merge.

### Sources file

```json
[
  { "name": "my-shop", "shop": "My Shop", "kind": "search", "category": "smartphone",
    "search_url": "https://shop.example/search?q={query}", "follow": ["/product/"], "max_depth": 1,
    "queries": ["smartphone", "iphone"], "recrawl_hours": 24 },
  { "name": "tariffs", "kind": "feed", "category": "mobile_plan", "feed_url": "https://t.example/feed.csv",
    "mapping": { "title": "name", "price": "setup_fee", "url": "link", "monthly": "monthly",
                 "min_term_months": "term", "promo_months": "promo_months", "promo_monthly": "promo_price",
                 "setup": "setup_fee" } }
]
```

The server reads it from `FINANCER_SHOP_SOURCES`; the phone takes it in the app (More > Shops to read).
`financer-shop-server --probe "pixel 9"` reads the sources once for that search into a throwaway database
and prints what it found: the way to check, from the machine that will run it, what is reachable.

## Deals, watches and messages

A **watch** is a search (or products) plus "tell me at or below X" and/or "at least Y % below the usual
price". Each deal is a message with a key; the same key is never sent twice, and a further message for
the same product needs a price drop of at least 2 %. The app polls `GET /v1/shop/notifications` and shows
local notifications; a server can also push:

| Setting | Delivers through |
|---|---|
| `FINANCER_SHOP_NTFY_URL` (+ `_NTFY_TOKEN`) | [ntfy](https://ntfy.sh): any ntfy app, one message per deal with a link |
| `FINANCER_SHOP_EXPO_PUSH=true` | the Expo push service, to the devices that registered with `POST /push-tokens` |
| `FINANCER_SHOP_WEBHOOK_URL` (+ `_WEBHOOK_SECRET`) | a JSON `POST` to your URL |

Expo push needs an EAS project id in the app's config; the app never fails without it, it then relies
on polling while open.

## Settings of the servers

| Variable | |
|---|---|
| `FINANCER_SHOP_API_TOKEN` | standalone server: required, 32+ characters (in the bundled server the finance token opens `/v1/shop` too) |
| `FINANCER_SHOP_BIND` | standalone listen address, default `127.0.0.1:8090` |
| `FINANCER_SHOP_WEB_DIR` | standalone: serve an exported web build at `/` |
| `FINANCER_SHOP_DATABASE_URL` | default `sqlite://financer-shop.db?mode=rwc`; bundled: next to the finance file, or the same PostgreSQL |
| `FINANCER_SHOP_SOURCES` / `_SOURCES_JSON` | sources file path / inline |
| `FINANCER_SHOP_CRAWL` | `false`: no background crawl (integrated behaviour) |
| `FINANCER_SHOP_REQUEST_GAP_SECS`, `_BATCH`, `_IDLE_SECS` | politeness and pacing |
| `FINANCER_SHOP_ENABLED` | bundled server: `false` switches the shop off |
| `FINANCER_ANTHROPIC_API_KEY`, `FINANCER_OPENAI_API_KEY`, `FINANCER_LLM_PROVIDER` | the model for `use_llm` sources |

## Building

```sh
cargo run -p financer-shop-server                       # standalone server
cargo run -p financer-server --features shop            # finance server with the shop at /v1/shop
cd apps/shopping && npm install && npm start            # the shopping app
cd apps/mobile && EXPO_PUBLIC_SHOPPING=1 npm start      # the finance app with the shop inside
```

A Docker image of the finance server with the shop inside: `docker build -f deploy/Dockerfile --build-arg FEATURES=shop .`
(written, not built here). There is no image of the standalone shop server yet.

The on-phone backend: `crates/embedded` builds `ShopBackend` by default, so
`apps/mobile/scripts/enable-embedded.sh` (see [EMBEDDED.md](EMBEDDED.md)) makes it available to both
apps. For `apps/shopping` run the same script (`apps/shopping/scripts/enable-embedded.sh`), which
points it at its own folder.

## API

All under `/v1/shop`, JSON, bearer token on servers (none in-process on the phone).

| | |
|---|---|
| `GET /info` | mode, counts, sources, notifiers |
| `GET/PUT/DELETE /categories[/{id}]` | the extensible schemas (422 with `problems` when invalid) |
| `POST /search` | `{query, category?, profile?, profile_name?, limit?}` → ranked items with explanations, picks, tiers, deals, savings |
| `POST /compare` | `{product_ids, profile?}` → side-by-side rows with the best marked |
| `GET/POST /products`, `GET/PUT/DELETE /products/{id}` | browse, add by hand, edit specs, price history and deal |
| `GET /profiles`, `PUT/DELETE /profiles/{name}` | saved weights and wishes (`default` is used by the app) |
| `GET/PUT /my/{category}` | what you pay now for a subscription |
| `GET/POST /index`, `GET/DELETE /index/{id}` | start an index run for a search, follow its progress, stop it |
| `GET/POST /watches`, `PUT/DELETE /watches/{id}` | price alerts |
| `GET /deals` | what is clearly below its usual price now |
| `GET /notifications`, `POST /notifications/read`, `POST/DELETE /push-tokens` | the message feed |

## What has and has not been checked

| Part | State |
|---|---|
| Ranking, formulas, schemas and extension, deals, plans, search, query language | unit-tested (`cargo test -p financer-shop-core`) |
| Extraction (JSON-LD, tables, feeds, sitemaps), the on-demand and continuous crawler, robots.txt, back-off, cancel, progress | tested against fake shops, and the real binary against a local web server over real HTTP |
| Storage, merging, price history, watches, messages, SQLite | tested; **PostgreSQL not run** (the migrations use only portable types) |
| API, notifiers (ntfy, Expo, webhook) | tested through the router with fake HTTP; **never sent to ntfy, Expo or a real endpoint** |
| Bundled server (one token for both apps), embedded `ShopBackend` | tested in-process; Kotlin bindings generate with `ShopBackend`; **not built into an APK or run on a phone** |
| The module's logic (client, weights, progress, notices, schema editing) | Node tests (`packages/shopping`) |
| The screens | typechecked, bundled for the web, and driven in a real browser against the real server (search, picks, compare, integrated-mode progress bar); **never run on a phone** |
| Notifee progress bar, foreground service, deal notifications, push token | written against the libraries' typings and docs; **never run on a device**. The foreground service type plugin is unverified on Android 14 |
| Real shops | **no real shop was read**: the sources are yours to configure, and whether a given shop publishes usable structured data is for you to find out with `--probe` |
