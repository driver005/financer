# Grocery screens: UI pass

A visual and structural pass over the grocery side of the mobile app: Prices, Scan, Recipes, Meal
plan (with the shopping list and the recipe picker), Usual items and Receipts. Behaviour, data flow,
API calls and routes are unchanged.

**Research note.** The Mobbin reference library was not available (it needs a paid plan), so none of
this was copied from a reference. The layouts follow patterns that are common in shopping-list and
recipe apps (price comparison cards with a highlighted winner, a week strip, a grouped checklist with
a sticky total, ranked recipe cards with a match ring) combined with the app's Duolingo-like look
(purple, chunky buttons, the pig).

## What each screen does now

| Screen | Hero / primary action | Notes |
| --- | --- | --- |
| Prices | A purple card names the cheapest chain overall (or the tied chains) and what choosing the cheapest chain per item saves. Primary action: Refresh. | One comparison card per item; the cheapest chain is tinted and badged, the others show "+0,06 €". Offer badge, validity date, "Save x compared with y". Skeleton cards while loading; mascot empty state with a Refresh button. |
| Scan | Frame with corner brackets and "Hold the barcode inside the frame", one button to start the camera. | Result card: verdict banner, one row per chain (winner highlighted), notes, one action "Add to usual items". Without a camera (web) the frame is a still illustration and the typed number is the way in. |
| Recipes | Ranked cards (server order; the first is badged "Best match"). | Colour avatar, minutes and servings, match ring (percent of ingredients you already buy), cost per serving of the missing priced items, offer badges, filter chips in a horizontal strip, mascot empty state with "Clear filters". |
| Meal plan | Week strip with today filled and a dot on planned days (tap jumps to the day), meal cards with colour avatars and a servings stepper. | Shopping list: verdict and best split, totals per single shop, then one checklist per chain with subtotal and progress, then unpriced, unmatched and pantry. A sticky bar at the bottom keeps the budget verdict, the total and the tick progress in view. |
| Usual items | Grouped quantity rows with a stepper (the minus becomes a bin at 1). | "Save my list" is pinned below the list. |
| Receipts | Three capture tiles (Scan, Photo, PDF); pasting text is a collapsed section. | Rows with chain avatar, date, item count, total and a "Check" badge when items do not add up. Mascot empty state with "Scan a receipt". |

## Design rules used

- **Spacing and type:** a 4/8 grid (`space` in `components/grocery/primitives.tsx`), corner radii 12/16/24, the existing type variants of the kit.
- **Money:** always `formatCents` (de-DE notation) and drawn with tabular numerals (`Money`), so columns line up.
- **Colour:** status colours come from `toneColours` in `src/groceryView.ts` (text, tint, border for good / bad / offer / accent, light and dark). A unit test checks that every text on its tint, and every avatar letter, has a contrast of at least 4.5:1.
- **Targets:** buttons, steppers, icon buttons, rows and tiles are at least 44 high; filter chips are 36 with a 4px hit slop above and below.
- **Motion:** press feedback is a small shrink (no animation to switch off). The check-off pop and the skeleton pulse check `useReducedMotion` and stay still when it is on; the jump to a day in the week strip is not animated then either.
- **Accessibility:** rows and cards that read as one thing are one accessible element with a full label (for example "Lidl 1,29 € for Bananen, cheapest"); checkboxes have the checkbox role and state; the ring is a progressbar with a spoken value; text uses the system font scale, avatars and the ring numbers do not.
- **Empty and loading:** every list has a skeleton while it loads and a mascot empty state with at most one action.

## Code

- `src/groceryView.ts`: pure helpers (colour maths, avatars, `rankPrices`, `itemSaving`, `summarizePrices`, `costPerServing`, `toneColours`). Tests in `tests/groceryView.test.ts`.
- `src/components/grocery/`: `primitives.tsx` (Money, Panel, Group, Badge, Avatar, MatchRing, Checkbox, Stepper, Skeleton, EmptyState, FilterChip and more), `ChainPriceRow.tsx` (one chain in a comparison, used by Prices and Scan), `ScanFrame.tsx`.
- Restyled: `app/{prices,scan,recipes,mealplan,basket,receipts}.tsx`, `components/{ShoppingListView,MealPicker,BarcodeScanner}.tsx`.
- Nothing in `theme.ts`, `kit.tsx`, `ui.tsx`, `Mascot.tsx` or the layout was changed. The screens use the shared `Screen`, `Title`, `NeedsSetup`, `ChunkyButton`, `Searchbar`, `TextInput`, `List.Accordion`, `Snackbar` and `Mascot` as they are.

## Not done

- The screens that are not tabs (Meal plan, Usual items, Receipts, Scan) have no back button; adding one needs a change to the navigation layout, which is outside this pass.
- Nothing was run on a phone. The camera view (and its frame overlay) only exists on iOS and Android and was not seen; the web build shows the still frame.
- Dynamic type was reasoned about (flexible rows, wrapping text) but not tested at the largest sizes.

## Screenshots

Taken from the web build at 390 x 844 with a small mock of the `/v1` endpoints, in `docs/ui/grocery/`:
`prices-before-light` / `prices-after-light`, `mealplan-before-dark` / `mealplan-after-dark`, `mealplan-list-dark` (checklist with two items ticked), `recipes-after-dark`, `recipes-skeleton-dark`, `scan-result-light`, `receipts-after-light`, `basket-after-dark`.
