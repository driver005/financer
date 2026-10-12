# Meal plan and shopping list

Plan up to one meal per day for a week, and get the shopping list for it: ingredients added up,
priced per chain, and checked against what is left of the groceries budget. In the app, open
**Recipes** and tap **Plan my week**.

## How it works

* A week runs Monday to Sunday and is named by its Monday. Any day of a week in a request means
  that week.
* A day holds a bundled recipe (by id) or a suggested recipe (title plus ingredients, for example
  an idea from the language model). Servings are 1 to 20; amounts are scaled from the recipe's own
  servings to the planned ones.
* The shopping list reads each ingredient amount ("250 g", "2 EL", "1/2 Dose", "2 Zehen"), converts
  it to the item's base unit (kg, l or piece) with typical weights for counted units, adds up the
  same item across meals and rounds up to whole **reference packs** (the pack size prices are
  normalised to, see `GET /v1/catalog`). Weight and volume are treated alike (1 g is 1 ml).
* Items on the **pantry list** are left off. The default is what the catalog marks as pantry (salt,
  pepper, sugar, oil, vinegar, stock, curry) plus flour. It is stored in the `pantry_staples`
  setting and can be edited in the app or with `PUT /v1/meal-plan/pantry`.
* Pricing uses the stored prices that are still valid and the same basket planner as the rest of
  the app: totals per chain, and the best split across chains only when it saves at least 0.50 EUR
  against the cheapest single chain. Items no chain has a price for are listed apart and are not in
  the total. Ingredients of suggested recipes that match no catalog item are listed apart too.
* The budget check compares the total of the best plan with what is left of this budget period's
  groceries limit (the same number as in `GET /v1/affordability`). Without a groceries limit the
  cost is shown without a verdict.
* Ticking items off in the app is local to the device (per week); it is not synced.

## API

| Route | |
| --- | --- |
| `GET /v1/meal-plan?week=` | the planned days of the week |
| `PUT /v1/meal-plan?week=` | replace the week (`{"days": [...]}`; one meal per day) |
| `GET /v1/meal-plan/shopping-list?week=&date=` | the priced list; `date` is the local day, used to find the budget period |
| `GET/PUT /v1/meal-plan/pantry` | the pantry list (`{"items": ["salz", ...]}`) |

## Limits

* Amounts are free text in the recipe data, so conversions are estimates. Unknown units count as
  pieces; "nach Geschmack" counts as a tiny amount, which still needs one pack when the item is not
  on the pantry list.
* Leftovers are not carried over between meals or weeks: every item is bought in whole packs.
* The budget check always uses the current budget period, whichever week is shown.
* A recipe removed from the bundled dataset stays on the plan but adds nothing to the list; the
  list names it.
* The plan is not part of the JSON export or import.
* Prices must have been refreshed (see `docs/PRICES.md`); without them every item is "no price
  listed".
