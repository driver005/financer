# What shopping and comparison apps look like, and what we took from it

**How this was researched, and its limits.** The task was to look at Dribbble's shopping-assistant
designs and extract the common patterns. `dribbble.com` is not reachable from the sandbox this was
written in (the host does not resolve, it has to be allowed in the session's network settings), so **no
shot was opened and no screenshot was looked at**. What follows comes from web-search result text
(shot titles, tags and the view and like counts that search listings show), from published UX research
on shopping interfaces (Baymard, Google Cloud's and Algolia's commerce guides) and from the standard
platform and accessibility guidance. Where a statement rests on a single search snippet it says so. The
Dribbble part is therefore a **tag-and-title level reading, not a visual survey**: redo it with the site
open before treating it as more than a starting point.

## What the Dribbble results showed

Shots found for "shopping assistant", "price comparison" and "product card":

- Shopping-assistant concepts are tagged with *chatbot*, *location map*, *nearby shops*, *smart cart*
  and *AI* ("Shopping Assistant App", "Zave - AI Shopping Assistant", "Shoply | Smart Shopping").
  So the genre is: a **search or chat box on top, answers as product cards underneath**, often with a map
  or list of nearby shops.
- The highest-engagement shots in the product areas (search listings quote them) are interaction
  prototypes and product-card systems: "E-commerce - Add to compare list" (255 likes, 65.2k views), a
  mobile catalog shot with a product grid (266 likes, 53.4k views), a mechanical-keyboard shop app
  (403 likes, 193k views). The popularity is of **visual polish and one clear interaction**, not of
  feature count.
- Comparison shots (tags *compare*, *product comparison*, *specification table*, "camera comparison",
  "car comparison with match percentage") use **columns per product, spec rows, and a single "match" or
  "winner" cue**; the add-to-compare flow has a call to action that becomes active when two products are
  picked (one write-up of the "Add to compare list" prototype).
- Product-card shots converge on: large image on top, name, one price line, a rating or badge, a small
  heart or add action, a lot of white space, soft rounded corners.

## The common screens (what almost every concept contains)

1. **Home / discover**: search bar at the top, category chips or icons, a "for you" or "deals" carousel,
   a product grid. Bottom navigation with four or five items.
2. **Results / listing**: a **2-column grid on phones**, 3 to 4 on tablets and 4+ on desktop; a sticky
   row with *Filter* and *Sort*; chips that show applied filters.
3. **Product detail**: gallery, title, price (large), rating, a deal or discount badge, the offers from
   several shops, specs as a list, and one primary action.
4. **Compare**: 2 to 4 columns; sticky product headers; spec rows; the better value highlighted.
5. **Wishlist / watch list**: saved items with their current price and a price-drop marker.
6. **Assistant / chat**: a prompt box, suggestion chips, answers as cards, never a wall of text.

## What the research says about how they should be built

**Listing and filters** (Baymard, via its published findings)
- On mobile, filters live in a separate interface; the damage is the back-and-forth. Keep the filter UI one
  tap away, show **applied filters as removable chips** above the list (28 % of sites do not, and
  testing shows it speeds up finding things), and restore the scroll position after a product page.
- Offer sorting by **price, rating, best-selling and newest** (64 % of sites miss at least one).
- People filter by **price** more than by anything else: make it the first filter.
- Filtering excludes; sorting orders. Do not mix them in one control.
- 78 % of mobile product lists perform poorly in Baymard's benchmark: the bar is low, and clear
  structure beats decoration.

**Comparison** (Baymard comparison-tool research)
- Offer comparison for spec-driven products (a phone is the textbook case).
- **Sticky column headers** with title, price and thumbnail, so you never scroll back up to see which column
  is which.
- Most useful first: **hide identical specs** and show only differences; second best: shade the rows that
  differ; the last resort is no emphasis.
- Make the "compare" state persistent and visible (a bar that shows how many are selected).

**Assistant layouts** (Google Cloud conversational commerce guide, Algolia and Coveo on agentic commerce)
- After the first answer show **product cards, not text**: image, price, rating, availability, and a path
  to the product.
- Ask a **clarifying question** when the query is ambiguous; suggest refinements instead of making the person
  set filters.
- Be **transparent**: say why something is recommended (our per-criterion points) and show prices and the
  shop it comes from.
- Keep the assistant on the same page as the results, so the results update as the question changes (a
  side panel on large screens).
- Say so when little or nothing was found and offer an alternative.

**Price history and deals**
- A line chart of the recorded prices, usually 30 days to a year, and the lowest price of the last 30 days
  (it is a legal requirement for discounts in the EEA) is what makes a "deal" believable. Our deal logic
  compares with our own history for the same reason.

## Layout and platform principles we follow

- **Adaptive layouts by window size class** (Material 3): *compact* under 600, *medium* 600 to under
  840, *expanded* 840 and up. Navigation follows: **bottom bar** on compact, **navigation rail** on medium,
  **rail or sidebar** on expanded. Content gets a maximum width and more columns, it does not stretch.
- **Touch targets**: at least **44 pt** (Apple HIG) / **48 dp** (Material); WCAG 2.2 AA requires 24 px at
  the very least. Small icons get a larger invisible hit area.
- **Grid of 4**: all spacing from one scale on a 4-pixel unit (Tailwind's scale is exactly that).
- **Hierarchy through size, weight and colour**, not through more boxes; fewer borders, more spacing and
  surface contrast (Refactoring UI). Design in grey first; one accent colour; 8 to 10 greys, a few shades of the
  accent; greys with a slight tint of the brand hue.
- **Semantic tokens**: components never use raw values; they use roles (`surface`, `text-muted`,
  `border-subtle`, `accent`, `danger`), which map to the palette. That is what makes dark mode and
  re-theming a change in one file, and what makes "no manual colours" enforceable.
- **Three token layers**: primitive (the Tailwind scale), semantic (roles), component (what a Button
  uses). We keep the first two in `packages/ui/src/constants/` and the third inside each component.
- **States are part of the design**: loading (skeletons), empty (say what is missing and offer one
  action), error (say what to do), no results, offline.
- **Contrast**: text 4.5:1, large text and UI parts 3:1, in both themes. Colour is never the only carrier
  of meaning (a deal has a label as well as a green).

## What this means for our app, concretely

| Finding | Decision |
|---|---|
| Search box on top, results as cards | The Search screen leads with a `SearchBar` and suggestion chips; results are `ProductCard`s with image, price, score and the reason |
| 2 columns on phone, more on larger | `ProductGrid` chooses columns from the breakpoint (2 / 3 / 4) |
| Applied filters as chips, sort control | `FilterBar` with removable chips and a sort menu |
| Compare with sticky headers, hide identical specs | `ComparisonTable` with sticky first column and header, and a "differences only" switch (default on) |
| Explain recommendations | `ScoreRing` plus per-criterion `MeterRow`s, strengths and weaknesses as chips |
| Deals believable | `PriceHistory` sparkline, "lowest in 90 days", deal badge with a label |
| Adaptive navigation | `AppShell`: bottom bar (compact), rail (medium), sidebar (expanded) |
| One-hand mobile use | Primary actions at the bottom; filters in a sheet |

## Sources

- Dribbble pages as surfaced by search (titles, tags, counts only): collections for *compare*, *Amazon
  Prototype - add to compare list*, *Product cards*, *Shopping app design*, *Shopping Assistant App*.
- Baymard Institute: state of e-commerce filters, mobile filtering, sorting tools, comparison tool
  research (summaries; the full guidelines are paywalled).
- Google Cloud, *Conversational Commerce agent user experience guide*; Algolia, *Agentic UI for
  e-commerce*; Coveo, *Conversational product discovery*.
- Material Design 3 window size classes and adaptive navigation (through secondary write-ups, not the
  spec itself: check the breakpoints at m3.material.io).
- Apple Human Interface Guidelines and Material touch-target sizes, WCAG 2.2 SC 2.5.8 and 2.5.5 (through
  secondary summaries).
- Refactoring UI (Wathan, Schoger) through community summaries; design-token naming guides (three-tier model).
