# Price sources

Lidl, Aldi, Kaufland and Rewe have no public price API, so Financer does not ship guessed
URLs or site-specific scrapers. You tell the server which pages to read, and it uses only
standards-based sources:

- **schema.org JSON-LD** (`json_ld`): many shop and offer pages embed products and offers as
  `<script type="application/ld+json">`. Anything the server finds there is used.
- **Open Prices** (`open_prices`): crowdsourced shelf prices from prices.openfoodfacts.org for
  barcodes you assign to a catalog item. Only prices seen in one of the four chains and not
  older than `max_age_days` (default 60) are used.

- **Pages read by a model** (`llm_page`): for pages without structured data (most offer
  pages), your configured Claude or OpenAI model reads the page's visible text and lists the
  products and prices. It works on any layout without a parser written for it. It costs API
  calls (at most 5 model calls of 12,000 characters per page per refresh), and a product is only
  accepted if its price text literally appears in the page, so invented prices are dropped.

I did not write per-retailer page parsers: I could not check them against the live sites, so
`llm_page` is the way to read a page whose layout is unknown. Whether a particular retailer's
page is reachable, allowed by its robots.txt and read well is something only
`--probe-prices` on your own server can tell you.

## Configure

Create a JSON file and point `FINANCER_PRICE_SOURCES` at it:

```json
[
  { "type": "json_ld", "chain": "rewe", "urls": ["https://example.invalid/replace-with-a-real-offers-page"], "is_offer": true },
  { "type": "llm_page", "chain": "kaufland", "urls": ["https://example.invalid/replace-with-a-real-offers-page"], "is_offer": true },
  { "type": "open_prices", "max_age_days": 60,
    "items": [ { "item": "milch", "barcode": "<EAN of a milk you buy>" } ] }
]
```

`chain` is one of `rewe`, `lidl`, `aldi`, `kaufland`. `item` is a key from `GET /v1/catalog`.

## Check before you rely on it

```sh
FINANCER_PRICE_SOURCES=sources.json financer-server --probe-prices
```

This fetches every source once, **from the machine that will run the server** (datacenter
addresses are blocked more often than home connections), and prints per source whether it
worked, how many offers it found, how many could be turned into comparable prices and why
the rest were skipped (`unmatched`, `no_size`, `size_mismatch`, `bad_price`). It does not
touch the database. Exit code 1 means at least one source failed.

## How prices become comparable

Chains sell different pack sizes. Each offer's title (or size field) is parsed for a size
(`500 g`, `1,5 l`, `6 x 1,5 l`, `10er`), matched to a catalog item by whole words
(`Milchschnitte` is not milk), and converted to that item's **reference pack** (milk 1 l,
pasta 500 g, eggs 10). Offers without a readable size are skipped rather than guessed.

## Manners

Requests identify themselves, obey `robots.txt` (an unreachable or 5xx robots.txt means "do
not fetch"), wait 3 seconds between requests to one host, and cap responses at 3 MB. Using
them may still conflict with a site's terms; this is for personal use only. Nothing is
fetched unless you configure a source, and refreshes run once a day (`FINANCER_REFRESH_HOURS`).

## What a live probe showed (11 Oct 2026)

`--probe-prices` was run once from a GitHub Actions runner (a datacenter address, so results can
differ from your home connection). It is polite: robots.txt is obeyed and requests are spaced.
The workflow is `.github/workflows/probe.yml`; the pages tried are in `.github/probe/sources.json`.

| Source | Result |
|---|---|
| Rewe `/angebote/` | HTTP 403 (refused to the runner) |
| Kaufland `www.kaufland.de/angebote/` | HTTP 403 (refused to the runner) |
| Lidl `billiger-montag` page | fetched (200), two structured-data blocks, **none is a product**, so `json_ld` found 0 offers |
| Aldi Nord `angebote.html` | fetched (200, 620 KB), **no structured data at all**, so `json_ld` found 0 offers |
| Open Prices | worked in principle (see below) |

What this means:

- `json_ld` does not work for Lidl or Aldi on those pages. Use `llm_page` (your model reads the
  page; costs API calls) for them, or pick other pages. Which pages work for you is still to be
  checked from your own connection, especially Rewe and Kaufland (403 may be only the runner).
- **Open Prices**: the old code first looked each barcode up on `world.openfoodfacts.org/api`,
  whose robots.txt says `Disallow: /api` for everyone, so the polite client refused it (correctly).
  The Open Prices response already contains the product name, pack size and store brand, so the
  source now uses only `prices.openfoodfacts.org` and no second lookup. A repeat probe confirmed
  it: the source is `ok`, no robots.txt refusal, and it fetched and parsed a live offer for the
  test barcodes. That offer was then (correctly) rejected as a `size_mismatch`, because the probe
  deliberately mapped a Nutella barcode to the catalog item `milch`. So the whole path works
  against the live service; whether it yields useful prices depends on the barcodes you choose.
- Open Prices only helps for products someone has recorded a price for in one of the four chains
  (matched by store brand), so expect sparse data.
