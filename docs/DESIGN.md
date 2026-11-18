# Pantry design system — Dribbble-inspired food app

Reference shots studied (inspiration for layout, colour and rhythm — not copied):

- **Foody – Food Recipe App** by Andri Setiawan / SLAB Design Studio — ink + white minimalism, large food photography, clean bottom navigation: https://dribbble.com/shots/22830914-Foody-Food-Recipe-App
- **Bodega – Grocery list App** by Ipanadh — soft green canvas, white cards, green pill CTA, simple product rows: https://dribbble.com/shots/21523517-Bodega-Grocery-list-App
- **Meto – Shopping list** by Vasile Labici — grouped list cards on a soft tinted canvas: https://dribbble.com/shots/20523531-Meto-Shopping-list-mobile-application

Stitch reference screens regenerated from these patterns in project `9534181714922376088` (design systems *Botanical Pantry*, *Artisanal Organic Provisions*, *Artisanal Market Narrative*).

## Colours

| Role | Hex |
|---|---|
| Canvas | `#F4F6F3` |
| Surface | `#FFFFFF` |
| Tinted surface | `#EDF3ED` |
| Ink | `#171A17` |
| Muted ink | `#6B746B` |
| Hairline | `#E2E8E1` |
| Fresh green | `#2F7D5D` |
| Green soft | `#E5F1E9` |
| Offer coral | `#E2563B` |
| Offer soft | `#FDECE7` |

Dark mode: canvas `#101612`, surface `#1A231D`, text `#F7FAF7`, accent `#74C79C`.

## Type

**Fraunces** for display headings and large figures. **Plus Jakarta Sans** for body, labels and controls. Body 14px/21. Caps micro-labels with letter spacing.

## Shape & depth

- Cards: 24px radius, 1px hairline, soft green-tinted shadow.
- Buttons and chips: full pill, 46px min touch height.
- Inputs: 14px radius, white, hairline border.
- Food thumbnails: 16px radius. Photos carry visual weight; no gradients, no emoji icons.

## Components

- Floating bottom bar: white rounded pill with shadow; active item gets a green soft icon bubble and green label.
- Brand card: square monogram tile, name, visits/monthly spend, edit icon, "what I buy here" area.
- Shopping row: round checkbox, item name, quantity, store, coral `ANGEBOT` badge with price when matched to an offer.
- Offer rows: coral price badge and validity date.

## Price detail and best-buy plan

- Tapping a shopping-list item opens a full-screen price view: large per-discounter line chart, colour-coded legend, current/min/average figures, weekday forecast and an inline "add a price" form.
- The "Best prices" action on the list selects discounters and generates a local plan: cheapest chain per item, savings versus the priciest selected chain, and the probably-cheapest weekday/date.
- Curves start from local sample prices; Settings removes them so only your own prices remain.

## Behaviour

Loading skeletons, empty state with action, inline errors, 44px+ touch targets, light and dark.
