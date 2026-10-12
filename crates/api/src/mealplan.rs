//! Weekly meal plan and the shopping list made from it.
//!
//! A week runs Monday to Sunday and is named by its Monday. The pantry list (things assumed to be
//! at home) is the `pantry_staples` entry of the settings table.

use std::collections::HashSet;

use axum::extract::{Query, State};
use axum::Json;
use financer_core::{BudgetPeriod, Catalog, Category, Chain, Money, CATALOG};
use financer_recipes::amount::QuantityLabel;
use financer_recipes::{
    BudgetCheck, MealIngredient, PlannedMeal, Recipe, ShoppingLine, ShoppingListBuilder,
    ShoppingPricer,
};
use financer_store::StoredMealDay;
use serde::{Deserialize, Serialize};
use time::{Date, Duration, OffsetDateTime};
use utoipa::ToSchema;

use crate::budget_period::BudgetPeriods;
use crate::dto::ErrorBody;
use crate::grocery::{Grocery, MIN_PLAN_SAVING_CENTS};
use crate::routes::ApiError;
use crate::AppState;

const PANTRY_KEY: &str = "pantry_staples";
const MAX_SERVINGS: u32 = 20;
const MAX_TITLE_CHARS: usize = 120;
const MAX_INGREDIENTS: usize = 40;
const MAX_NAME_CHARS: usize = 80;
const MAX_AMOUNT_CHARS: usize = 40;
const MAX_PANTRY_ITEMS: usize = 100;

// ---- wire types ----

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct WeekQuery {
    /// Any day of the week; the week runs Monday to Sunday. Defaults to the current week.
    #[param(value_type = Option<String>, format = Date, example = "2026-10-12")]
    week: Option<Date>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ShoppingQuery {
    /// Any day of the week to shop for. Defaults to the current week.
    #[param(value_type = Option<String>, format = Date, example = "2026-10-12")]
    week: Option<Date>,
    /// The day to treat as today when looking up the groceries budget left. Defaults to today (UTC).
    #[param(value_type = Option<String>, format = Date, example = "2026-10-12")]
    date: Option<Date>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MealIngredientInput {
    pub name: String,
    /// Free text such as `250 g` or `2 EL`.
    pub amount: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MealDayInput {
    #[schema(value_type = String, format = Date, example = "2026-10-13")]
    pub date: Date,
    /// A bundled recipe (from `GET /v1/recipes`). Use this or `title` with `ingredients`.
    pub recipe_id: Option<String>,
    /// A suggested recipe that is not in the dataset, e.g. an idea from `POST /v1/recipes/ideas`.
    pub title: Option<String>,
    /// Ingredients of the suggested recipe, as written for `recipe_servings`.
    pub ingredients: Option<Vec<MealIngredientInput>>,
    /// Servings to cook (1 to 20).
    pub servings: u32,
    /// Servings the suggested recipe's amounts are written for. Defaults to `servings`.
    pub recipe_servings: Option<u32>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MealPlanInput {
    /// At most one meal per day; days not listed are empty. Replaces the whole week.
    pub days: Vec<MealDayInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MealIngredientDto {
    pub name: String,
    pub amount: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MealDayDto {
    #[schema(value_type = String, format = Date)]
    pub date: Date,
    pub recipe_id: Option<String>,
    pub title: String,
    pub servings: u32,
    /// Servings the ingredient amounts are written for.
    pub recipe_servings: u32,
    pub ingredients: Vec<MealIngredientDto>,
    /// False when the stored recipe id is no longer in the dataset; such a meal adds nothing to the
    /// shopping list.
    pub available: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MealPlanDto {
    #[schema(value_type = String, format = Date)]
    pub week_start: Date,
    #[schema(value_type = String, format = Date)]
    pub week_end: Date,
    /// The planned days, oldest first.
    pub days: Vec<MealDayDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PantryItemDto {
    pub item: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PantryDto {
    /// Items assumed to be at home; they are left off the shopping list.
    pub items: Vec<PantryItemDto>,
    /// True until the list is saved for the first time.
    pub is_default: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PantryUpdate {
    /// Catalog keys (see `GET /v1/catalog`).
    pub items: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShoppingItemDto {
    pub item: String,
    pub name: String,
    /// What the plan needs, e.g. `750 g`.
    pub needed: String,
    /// Reference packs to buy.
    pub packs: u32,
    /// Size of one pack, e.g. `500 g`.
    pub pack: String,
    /// The meals that use it.
    pub meals: Vec<String>,
    /// Price of one pack at the chosen chain; missing for items nobody has a price for.
    #[schema(value_type = Option<i64>)]
    pub pack_price_cents: Option<Money>,
    /// `packs` times the pack price.
    #[schema(value_type = Option<i64>)]
    pub line_cents: Option<Money>,
    pub is_offer: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShoppingStopDto {
    #[schema(value_type = String)]
    pub chain: Chain,
    #[schema(value_type = i64)]
    pub subtotal_cents: Money,
    pub items: Vec<ShoppingItemDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShoppingPlanDto {
    /// One stop when everything is bought at one chain, more when splitting saves enough.
    pub stops: Vec<ShoppingStopDto>,
    #[schema(value_type = i64)]
    pub total_cents: Money,
    /// The same items at the cheapest chain that has all of them, if there is one.
    #[schema(value_type = Option<i64>)]
    pub single_chain_total_cents: Option<Money>,
    pub split: bool,
    /// What splitting saves compared with the single chain; zero when not splitting.
    #[schema(value_type = i64)]
    pub saving_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChainTotalDto {
    #[schema(value_type = String)]
    pub chain: Chain,
    /// Price of the items this chain stocks.
    #[schema(value_type = i64)]
    pub total_cents: Money,
    /// Names of priced items this chain does not stock.
    pub missing: Vec<String>,
    pub complete: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnmatchedDto {
    pub name: String,
    pub amounts: Vec<String>,
    pub meals: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MealBudgetDto {
    /// What is left of this period's groceries limit; missing when no limit is set.
    #[schema(value_type = Option<i64>)]
    pub budget_cents: Option<Money>,
    /// `groceries_envelope` or `none`.
    pub budget_source: String,
    /// Cost of the priced items on the best plan.
    #[schema(value_type = i64)]
    pub estimated_cents: Money,
    /// Budget minus estimate; negative when over.
    #[schema(value_type = Option<i64>)]
    pub left_after_cents: Option<Money>,
    pub fits: Option<bool>,
    /// Items that are not in the estimate because they have no price.
    pub unpriced_count: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ShoppingListDto {
    #[schema(value_type = String, format = Date)]
    pub week_start: Date,
    #[schema(value_type = String, format = Date)]
    pub week_end: Date,
    pub meals_planned: u32,
    /// Planned meals that could not be used (recipe no longer in the dataset).
    pub skipped_meals: Vec<String>,
    /// The cheapest way to buy the priced items; missing when no item has a price.
    pub plan: Option<ShoppingPlanDto>,
    /// The priced items per chain, cheapest complete chain first.
    pub per_chain: Vec<ChainTotalDto>,
    /// Items nobody has a price for.
    pub unpriced: Vec<ShoppingItemDto>,
    /// Ingredients that could not be matched to a known item.
    pub unmatched: Vec<UnmatchedDto>,
    /// Needed by the plan but on the pantry list.
    pub pantry_skipped: Vec<PantryItemDto>,
    pub budget: MealBudgetDto,
}

#[derive(Serialize, Deserialize)]
struct StoredIngredient {
    name: String,
    amount: String,
}

// ---- logic ----

/// Weeks run Monday to Sunday.
pub struct Weeks;

impl Weeks {
    /// The Monday of the week `date` is in.
    pub fn monday(date: Date) -> Option<Date> {
        date.checked_sub(Duration::days(i64::from(
            date.weekday().number_days_from_monday(),
        )))
    }

    /// The Sunday of the week that starts on `monday`.
    pub fn sunday(monday: Date) -> Option<Date> {
        monday.checked_add(Duration::days(6))
    }

    /// First and last day of the week containing `date`.
    pub fn bounds(date: Date) -> Result<(Date, Date), ApiError> {
        Self::monday(date)
            .and_then(|m| Some((m, Self::sunday(m)?)))
            .ok_or_else(|| ApiError::BadRequest("week is out of range".into()))
    }
}

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct MealPlans;

impl MealPlans {
    fn today() -> Date {
        OffsetDateTime::now_utc().date()
    }

    fn bundled(id: &str) -> Option<&'static Recipe> {
        Recipe::bundled().iter().find(|r| r.id == id)
    }

    fn has_control(s: &str) -> bool {
        s.chars().any(char::is_control)
    }

    fn validate_servings(n: u32, what: &str) -> Result<(), ApiError> {
        if (1..=MAX_SERVINGS).contains(&n) {
            Ok(())
        } else {
            Err(ApiError::BadRequest(format!(
                "{what} must be 1 to {MAX_SERVINGS}"
            )))
        }
    }

    /// Check one day of a plan and turn it into its stored form.
    fn to_stored(day: &MealDayInput) -> Result<StoredMealDay, ApiError> {
        Self::validate_servings(day.servings, "servings")?;
        match (&day.recipe_id, &day.title) {
            (Some(id), None) => {
                if day.ingredients.is_some() || day.recipe_servings.is_some() {
                    return Err(ApiError::BadRequest(
                        "ingredients and recipe_servings go with a title, not a recipe_id".into(),
                    ));
                }
                let recipe = Self::bundled(id)
                    .ok_or_else(|| ApiError::BadRequest(format!("unknown recipe {id:?}")))?;
                Ok(StoredMealDay {
                    date: day.date,
                    recipe_id: Some(recipe.id.clone()),
                    title: recipe.title.clone(),
                    servings: day.servings,
                    base_servings: recipe.servings,
                    ingredients_json: None,
                })
            }
            (None, Some(title)) => {
                let title = title.trim();
                if title.is_empty()
                    || title.chars().count() > MAX_TITLE_CHARS
                    || Self::has_control(title)
                {
                    return Err(ApiError::BadRequest(format!(
                        "title must be 1 to {MAX_TITLE_CHARS} characters"
                    )));
                }
                let ingredients = day.ingredients.as_deref().unwrap_or_default();
                if ingredients.is_empty() || ingredients.len() > MAX_INGREDIENTS {
                    return Err(ApiError::BadRequest(format!(
                        "a suggested recipe needs 1 to {MAX_INGREDIENTS} ingredients"
                    )));
                }
                let mut stored = Vec::with_capacity(ingredients.len());
                for i in ingredients {
                    let (name, amount) = (i.name.trim(), i.amount.trim());
                    if name.is_empty()
                        || name.chars().count() > MAX_NAME_CHARS
                        || amount.chars().count() > MAX_AMOUNT_CHARS
                        || Self::has_control(name)
                        || Self::has_control(amount)
                    {
                        return Err(ApiError::BadRequest(
                            "an ingredient needs a name (up to 80 characters) and an amount (up to 40)"
                                .into(),
                        ));
                    }
                    stored.push(StoredIngredient {
                        name: name.to_string(),
                        amount: amount.to_string(),
                    });
                }
                let base = day.recipe_servings.unwrap_or(day.servings);
                Self::validate_servings(base, "recipe_servings")?;
                Ok(StoredMealDay {
                    date: day.date,
                    recipe_id: None,
                    title: title.to_string(),
                    servings: day.servings,
                    base_servings: base,
                    ingredients_json: Some(
                        serde_json::to_string(&stored).map_err(|_| ApiError::Internal)?,
                    ),
                })
            }
            _ => Err(ApiError::BadRequest(
                "give either a recipe_id, or a title with ingredients".into(),
            )),
        }
    }

    /// The meal behind a stored day: its title, ingredients and what they are written for.
    /// `None` for a bundled recipe that no longer exists.
    fn resolve(day: &StoredMealDay) -> Option<PlannedMeal> {
        match &day.recipe_id {
            Some(id) => Self::bundled(id).map(|r| PlannedMeal::from_recipe(r, day.servings)),
            None => {
                let ingredients: Vec<StoredIngredient> = day
                    .ingredients_json
                    .as_deref()
                    .and_then(|j| serde_json::from_str(j).ok())
                    .unwrap_or_default();
                Some(PlannedMeal {
                    title: day.title.clone(),
                    servings: day.servings,
                    base_servings: day.base_servings,
                    ingredients: ingredients
                        .into_iter()
                        .map(|i| MealIngredient {
                            item: None,
                            name: i.name,
                            amount: i.amount,
                        })
                        .collect(),
                })
            }
        }
    }

    fn day_dto(day: StoredMealDay) -> MealDayDto {
        let meal = Self::resolve(&day);
        MealDayDto {
            date: day.date,
            recipe_id: day.recipe_id,
            title: day.title,
            servings: day.servings,
            recipe_servings: meal.as_ref().map_or(day.base_servings, |m| m.base_servings),
            available: meal.is_some(),
            ingredients: meal
                .map(|m| {
                    m.ingredients
                        .into_iter()
                        .map(|i| MealIngredientDto {
                            name: i.name,
                            amount: i.amount,
                        })
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    async fn plan_dto(state: &AppState, start: Date, end: Date) -> Result<MealPlanDto, ApiError> {
        Ok(MealPlanDto {
            week_start: start,
            week_end: end,
            days: state
                .store
                .meal_plan(start, end)
                .await?
                .into_iter()
                .map(Self::day_dto)
                .collect(),
        })
    }

    pub async fn get_plan(
        State(state): State<AppState>,
        Query(q): Query<WeekQuery>,
    ) -> Result<Json<MealPlanDto>, ApiError> {
        let (start, end) = Weeks::bounds(q.week.unwrap_or_else(Self::today))?;
        Self::plan_dto(&state, start, end).await.map(Json)
    }

    pub async fn put_plan(
        State(state): State<AppState>,
        Query(q): Query<WeekQuery>,
        Json(input): Json<MealPlanInput>,
    ) -> Result<Json<MealPlanDto>, ApiError> {
        let (start, end) = Weeks::bounds(q.week.unwrap_or_else(Self::today))?;
        if input.days.len() > 7 {
            return Err(ApiError::BadRequest("a week has at most 7 days".into()));
        }
        let mut seen = HashSet::new();
        let mut days = Vec::with_capacity(input.days.len());
        for d in &input.days {
            if d.date < start || d.date > end {
                return Err(ApiError::BadRequest(format!(
                    "{} is not in the week {start} to {end}",
                    d.date
                )));
            }
            if !seen.insert(d.date) {
                return Err(ApiError::BadRequest(format!(
                    "{} appears twice; one meal per day",
                    d.date
                )));
            }
            days.push(Self::to_stored(d)?);
        }
        days.sort_by_key(|d| d.date);
        state.store.replace_meal_plan(start, end, &days).await?;
        Self::plan_dto(&state, start, end).await.map(Json)
    }

    // ---- pantry ----

    /// Pantry items out of the box: what the catalog marks as pantry, plus flour.
    fn default_pantry() -> Vec<String> {
        let mut keys: Vec<String> = CATALOG
            .iter()
            .filter(|i| i.pantry)
            .map(|i| i.key.to_string())
            .collect();
        keys.push("mehl".into());
        keys
    }

    async fn pantry_keys(state: &AppState) -> Result<(Vec<String>, bool), ApiError> {
        let stored = state.store.get_setting(PANTRY_KEY).await?;
        match stored.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()) {
            Some(keys) => Ok((keys, false)),
            None => Ok((Self::default_pantry(), true)),
        }
    }

    fn pantry_item(key: &str) -> PantryItemDto {
        PantryItemDto {
            item: key.to_string(),
            name: Grocery::item_name(key),
        }
    }

    fn pantry_dto(keys: &[String], is_default: bool) -> PantryDto {
        let mut items: Vec<PantryItemDto> = keys
            .iter()
            .filter(|k| Catalog::by_key(k).is_some())
            .map(|k| Self::pantry_item(k))
            .collect();
        items.sort_by_key(|a| a.name.to_lowercase());
        PantryDto { items, is_default }
    }

    pub async fn get_pantry(State(state): State<AppState>) -> Result<Json<PantryDto>, ApiError> {
        let (keys, is_default) = Self::pantry_keys(&state).await?;
        Ok(Json(Self::pantry_dto(&keys, is_default)))
    }

    pub async fn put_pantry(
        State(state): State<AppState>,
        Json(u): Json<PantryUpdate>,
    ) -> Result<Json<PantryDto>, ApiError> {
        if u.items.len() > MAX_PANTRY_ITEMS {
            return Err(ApiError::BadRequest(format!(
                "the pantry list holds at most {MAX_PANTRY_ITEMS} items"
            )));
        }
        let mut keys: Vec<String> = Vec::new();
        for k in u.items {
            if Catalog::by_key(&k).is_none() {
                return Err(ApiError::BadRequest(format!("unknown item {k:?}")));
            }
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
        let json = serde_json::to_string(&keys).map_err(|_| ApiError::Internal)?;
        state.store.set_setting(PANTRY_KEY, &json).await?;
        Ok(Json(Self::pantry_dto(&keys, false)))
    }

    // ---- shopping list ----

    /// What is left of this period's groceries limit, if there is one.
    async fn groceries_left(state: &AppState, today: Date) -> Result<Option<Money>, ApiError> {
        let budget = state.store.load_budget().await?;
        if !budget.envelopes.contains_key(&Category::Groceries) {
            return Ok(None);
        }
        // split transactions count by their parts
        let txs = state.store.list_effective_transactions().await?;
        let period = BudgetPeriod::containing(today, BudgetPeriods::payday(state).await?);
        Ok(Some(budget.remaining(Category::Groceries, &txs, period)))
    }

    fn item_dto(line: &ShoppingLine) -> ShoppingItemDto {
        let unit = Catalog::by_key(&line.item).map(|i| i.unit);
        ShoppingItemDto {
            item: line.item.clone(),
            name: Grocery::item_name(&line.item),
            needed: unit
                .map(|u| QuantityLabel::label(u, line.needed_milli))
                .unwrap_or_default(),
            packs: line.packs,
            pack: Catalog::reference_label(&line.item).unwrap_or_default(),
            meals: line.meals.clone(),
            pack_price_cents: None,
            line_cents: None,
            is_offer: false,
        }
    }

    fn by_name(a: &ShoppingItemDto, b: &ShoppingItemDto) -> std::cmp::Ordering {
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    }

    pub async fn shopping_list(
        State(state): State<AppState>,
        Query(q): Query<ShoppingQuery>,
    ) -> Result<Json<ShoppingListDto>, ApiError> {
        let today = q.date.unwrap_or_else(Self::today);
        let (start, end) = Weeks::bounds(q.week.unwrap_or(today))?;

        let mut meals = Vec::new();
        let mut skipped_meals = Vec::new();
        for day in state.store.meal_plan(start, end).await? {
            match Self::resolve(&day) {
                Some(m) => meals.push(m),
                None => skipped_meals.push(day.title),
            }
        }
        let (pantry_keys, _) = Self::pantry_keys(&state).await?;
        let pantry: HashSet<String> = pantry_keys.into_iter().collect();
        let list = ShoppingListBuilder::build(&meals, &pantry);

        let quotes = Grocery::plain_quotes(&Grocery::live_quotes(&state).await?);
        let priced = ShoppingPricer::price(
            &list.lines,
            &quotes,
            Money::from_cents(MIN_PLAN_SAVING_CENTS),
        );

        let line_of = |key: &str| list.lines.iter().find(|l| l.item == key);
        let plan = priced.plan.as_ref().map(|p| {
            let stops: Vec<ShoppingStopDto> = p
                .stops
                .iter()
                .map(|(chain, picks)| {
                    let mut items: Vec<ShoppingItemDto> = picks
                        .iter()
                        .filter_map(|pick| {
                            let line = line_of(&pick.item)?;
                            let mut dto = Self::item_dto(line);
                            dto.pack_price_cents = Some(pick.price);
                            dto.line_cents = Some(pick.price.times(line.packs));
                            dto.is_offer = pick.is_offer;
                            Some(dto)
                        })
                        .collect();
                    items.sort_by(Self::by_name);
                    ShoppingStopDto {
                        chain: *chain,
                        subtotal_cents: items.iter().filter_map(|i| i.line_cents).sum(),
                        items,
                    }
                })
                .collect();
            let split = stops.len() > 1;
            let saving = match (split, p.single_chain_total) {
                (true, Some(single)) if single > p.total => single - p.total,
                _ => Money::ZERO,
            };
            ShoppingPlanDto {
                stops,
                total_cents: p.total,
                single_chain_total_cents: p.single_chain_total,
                split,
                saving_cents: saving,
            }
        });

        let per_chain = priced
            .per_chain
            .iter()
            .map(|c| ChainTotalDto {
                chain: c.chain,
                total_cents: c.total,
                complete: c.missing.is_empty(),
                missing: c.missing.iter().map(|k| Grocery::item_name(k)).collect(),
            })
            .collect();

        let mut unpriced: Vec<ShoppingItemDto> = priced
            .unpriced
            .iter()
            .filter_map(|k| line_of(k))
            .map(Self::item_dto)
            .collect();
        unpriced.sort_by(Self::by_name);

        let estimated = plan.as_ref().map_or(Money::ZERO, |p| p.total_cents);
        let left = Self::groceries_left(&state, today).await?;
        let check = BudgetCheck::compare(estimated, left);
        let unpriced_count = (priced.unpriced.len() + list.unmatched.len()) as u32;

        Ok(Json(ShoppingListDto {
            week_start: start,
            week_end: end,
            meals_planned: meals.len() as u32,
            skipped_meals,
            plan,
            per_chain,
            unpriced,
            unmatched: list
                .unmatched
                .into_iter()
                .map(|u| UnmatchedDto {
                    name: u.name,
                    amounts: u.amounts,
                    meals: u.meals,
                })
                .collect(),
            pantry_skipped: list
                .pantry_skipped
                .iter()
                .map(|k| Self::pantry_item(k))
                .collect(),
            budget: MealBudgetDto {
                budget_cents: check.budget,
                budget_source: if check.budget.is_some() {
                    "groceries_envelope"
                } else {
                    "none"
                }
                .into(),
                estimated_cents: check.estimated,
                left_after_cents: check.left_after,
                fits: check.fits,
                unpriced_count,
            },
        }))
    }
}

// ---- handlers: thin shims, because `#[utoipa::path]` cannot annotate methods ----

/// The meals planned for a week (Monday to Sunday), one per day at most.
#[utoipa::path(get, path = "/v1/meal-plan", params(WeekQuery), responses(
    (status = 200, body = MealPlanDto), (status = 400, description = "Week out of range", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn get_meal_plan(
    State(state): State<AppState>,
    Query(q): Query<WeekQuery>,
) -> Result<Json<MealPlanDto>, ApiError> {
    MealPlans::get_plan(State(state), Query(q)).await
}

/// Replace the plan of a week. Each day holds a bundled recipe by id, or a suggested recipe by
/// title with its ingredients, and the servings to cook.
#[utoipa::path(put, path = "/v1/meal-plan", params(WeekQuery), request_body = MealPlanInput, responses(
    (status = 200, body = MealPlanDto),
    (status = 400, description = "Unknown recipe, day outside the week, duplicate day or bad value", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn put_meal_plan(
    State(state): State<AppState>,
    Query(q): Query<WeekQuery>,
    Json(input): Json<MealPlanInput>,
) -> Result<Json<MealPlanDto>, ApiError> {
    MealPlans::put_plan(State(state), Query(q), Json(input)).await
}

/// The shopping list for a week: ingredients of all planned meals added up (amounts scaled to the
/// servings and converted to packs), pantry items left off, priced per chain with the best split
/// and checked against what is left of the groceries budget.
#[utoipa::path(get, path = "/v1/meal-plan/shopping-list", params(ShoppingQuery), responses(
    (status = 200, body = ShoppingListDto), (status = 400, description = "Week out of range", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn get_shopping_list(
    State(state): State<AppState>,
    Query(q): Query<ShoppingQuery>,
) -> Result<Json<ShoppingListDto>, ApiError> {
    MealPlans::shopping_list(State(state), Query(q)).await
}

/// Items assumed to be at home (salt, oil, flour...); the shopping list leaves them off.
#[utoipa::path(get, path = "/v1/meal-plan/pantry", responses((status = 200, body = PantryDto)), security(("bearer" = [])))]
pub async fn get_pantry(State(state): State<AppState>) -> Result<Json<PantryDto>, ApiError> {
    MealPlans::get_pantry(State(state)).await
}

/// Replace the pantry list.
#[utoipa::path(put, path = "/v1/meal-plan/pantry", request_body = PantryUpdate, responses(
    (status = 200, body = PantryDto), (status = 400, description = "Unknown item or too many items", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn put_pantry(
    State(state): State<AppState>,
    Json(u): Json<PantryUpdate>,
) -> Result<Json<PantryDto>, ApiError> {
    MealPlans::put_pantry(State(state), Json(u)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn weeks_run_monday_to_sunday() {
        // 2026-10-12 is a Monday
        for day in 12..=18 {
            let d = Date::from_calendar_date(2026, time::Month::October, day).unwrap();
            assert_eq!(
                Weeks::bounds(d).ok(),
                Some((date!(2026 - 10 - 12), date!(2026 - 10 - 18))),
                "{d}"
            );
        }
        assert_eq!(
            Weeks::monday(date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 19))
        );
        // across month and year ends
        assert_eq!(
            Weeks::bounds(date!(2027 - 01 - 01)).ok(),
            Some((date!(2026 - 12 - 28), date!(2027 - 01 - 03)))
        );
        assert_eq!(
            Weeks::bounds(date!(2028 - 03 - 01)).ok(),
            Some((date!(2028 - 02 - 28), date!(2028 - 03 - 05)))
        );
    }

    #[test]
    fn weeks_at_the_edge_of_time_are_errors_not_panics() {
        let _ = Weeks::bounds(Date::MIN); // may be an error, must not panic
        assert!(Weeks::sunday(Date::MAX).is_none());
    }
}
