//! Prices, basket, receipts, affordability, recipes and settings.

use std::collections::{BTreeMap, HashSet};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use financer_core::{
    best_picks, by_key, plan_shopping, reference_label, what_can_i_buy, BasketItem, Category,
    Money, PriceQuote, YearMonth, CATALOG,
};
use financer_llm::{LlmSettings, Provider};
use financer_prices::{build_sources, refresh};
use financer_receipts::{habits, parse_receipt, ParsedReceipt};
use financer_recipes::{bundled, generate_ideas, rank_recipes, IdeaError, IdeaRequest, MatchInput};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{Date, OffsetDateTime};

use crate::dto::*;
use crate::routes::ApiError;
use crate::AppState;

const DEFAULT_HABIT_MODE: &str = "manual";
const MIN_PLAN_SAVING_CENTS: i64 = 50;

fn today() -> Date {
    OffsetDateTime::now_utc().date()
}

fn item_name(key: &str) -> String {
    by_key(key)
        .map(|i| i.name_de.to_string())
        .unwrap_or_else(|| key.to_string())
}

/// Stored quotes that are still valid today (an offer past its end date is not an offer).
async fn live_quotes(state: &AppState) -> Result<Vec<financer_store::StoredQuote>, ApiError> {
    let today = today();
    Ok(state
        .store
        .list_quotes()
        .await?
        .into_iter()
        .filter(|q| q.quote.valid_until.is_none_or(|d| d >= today))
        .collect())
}

fn plain_quotes(stored: &[financer_store::StoredQuote]) -> Vec<PriceQuote> {
    stored.iter().map(|q| q.quote.clone()).collect()
}

/// The basket the comparison runs on, and where it came from.
async fn effective_basket(state: &AppState) -> Result<(Vec<BasketItem>, &'static str), ApiError> {
    let mode = state
        .store
        .get_setting("habit_mode")
        .await?
        .unwrap_or_else(|| DEFAULT_HABIT_MODE.to_string());
    let from_receipts = || async {
        let parsed: Vec<ParsedReceipt> = state
            .store
            .list_receipts()
            .await?
            .iter()
            .filter_map(|r| serde_json::from_str(&r.json).ok())
            .collect();
        // with few receipts, one sighting is all the evidence there is
        Ok::<_, ApiError>(habits::usual_items(
            &parsed,
            if parsed.len() >= 4 { 2 } else { 1 },
        ))
    };
    match mode.as_str() {
        "receipts" => {
            let items = from_receipts().await?;
            if items.is_empty() {
                Ok((habits::starter_basket(), "starter"))
            } else {
                Ok((items, "receipts"))
            }
        }
        "spending" => Ok((habits::starter_basket(), "starter")),
        _ => {
            let items = state.store.usual_items().await?;
            if items.is_empty() {
                Ok((habits::starter_basket(), "starter"))
            } else {
                Ok((items, "manual"))
            }
        }
    }
}

// ---- prices ----

/// Fetch all configured price sources and store the result. A source that fails keeps its old
/// prices.
#[utoipa::path(post, path = "/v1/prices/refresh", responses(
    (status = 200, body = RefreshReportDto),
    (status = 503, description = "No price sources configured", body = ErrorBody)), security(("bearer" = [])))]
pub async fn refresh_prices(
    State(state): State<AppState>,
) -> Result<Json<RefreshReportDto>, ApiError> {
    refresh_prices_now(&state).await.map(Json)
}

/// The refresh behind `POST /v1/prices/refresh`; the server's daily scheduler calls it too.
pub(crate) async fn refresh_prices_now(state: &AppState) -> Result<RefreshReportDto, ApiError> {
    let sources = build_sources(&state.price_sources, today());
    if sources.is_empty() {
        return Err(ApiError::Unavailable(
            "no price sources configured (see docs/PRICES.md)".into(),
        ));
    }
    let result = refresh(&sources, state.http.as_ref()).await;

    let now = OffsetDateTime::now_utc().unix_timestamp();
    let ok_sources: Vec<String> = result
        .sources
        .iter()
        .filter(|s| s.ok)
        .map(|s| s.name.clone())
        .collect();
    let stored: Vec<_> = result
        .quotes
        .iter()
        .map(|q| financer_store::StoredQuote {
            quote: q.quote.clone(),
            product_name: q.product_name.clone(),
            shelf_price: q.shelf_price,
            source: q.source.clone(),
            fetched_at: now,
        })
        .collect();
    state.store.replace_quotes(&ok_sources, &stored).await?;

    Ok(RefreshReportDto {
        stored: state.store.list_quotes().await?.len(),
        unmatched: result.normalize.unmatched,
        no_size: result.normalize.no_size,
        size_mismatch: result.normalize.size_mismatch,
        bad_price: result.normalize.bad_price,
        sources: result
            .sources
            .into_iter()
            .map(|s| SourceStatusDto {
                name: s.name,
                ok: s.ok,
                offers_found: s.offers_found,
                error: s.error,
            })
            .collect(),
    })
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct PriceQuery {
    /// Only this catalog item.
    item: Option<String>,
}

/// Current prices per chain, cheapest first within each item.
#[utoipa::path(get, path = "/v1/prices", params(PriceQuery), responses((status = 200, body = Vec<PriceDto>)),
    security(("bearer" = [])))]
pub async fn list_prices(
    State(state): State<AppState>,
    Query(q): Query<PriceQuery>,
) -> Result<Json<Vec<PriceDto>>, ApiError> {
    let quotes = live_quotes(&state).await?;
    Ok(Json(
        quotes
            .iter()
            .filter(|s| q.item.as_deref().is_none_or(|i| s.quote.item == i))
            .map(quote_dto)
            .collect(),
    ))
}

/// For each item of your basket, the cheapest chain right now.
#[utoipa::path(get, path = "/v1/prices/best", responses((status = 200, body = Vec<PickDto>)), security(("bearer" = [])))]
pub async fn best_prices(State(state): State<AppState>) -> Result<Json<Vec<PickDto>>, ApiError> {
    let (basket, _) = effective_basket(&state).await?;
    let quotes = plain_quotes(&live_quotes(&state).await?);
    Ok(Json(
        best_picks(&basket, &quotes)
            .into_iter()
            .map(pick_dto)
            .collect(),
    ))
}

fn pick_dto(p: financer_core::BestPick) -> PickDto {
    PickDto {
        name: item_name(&p.item),
        item: p.item,
        chain: p.chain,
        price_cents: p.price,
        is_offer: p.is_offer,
        valid_until: p.valid_until,
        saving_vs_next_cents: p.saving_vs_next,
    }
}

// ---- basket ----

/// All items prices and recipes can refer to.
#[utoipa::path(get, path = "/v1/catalog", responses((status = 200, body = Vec<CatalogItemDto>)), security(("bearer" = [])))]
pub async fn catalog() -> Json<Vec<CatalogItemDto>> {
    Json(
        CATALOG
            .iter()
            .map(|i| CatalogItemDto {
                key: i.key.to_string(),
                name: i.name_de.to_string(),
                reference_pack: reference_label(i.key).unwrap_or_default(),
            })
            .collect(),
    )
}

#[utoipa::path(get, path = "/v1/basket", responses((status = 200, body = BasketDto)), security(("bearer" = [])))]
pub async fn get_basket(State(state): State<AppState>) -> Result<Json<BasketDto>, ApiError> {
    let (items, source) = effective_basket(&state).await?;
    Ok(Json(BasketDto {
        source: source.into(),
        items: items
            .into_iter()
            .map(|i| BasketItemOutDto {
                name: item_name(&i.item),
                reference_pack: reference_label(&i.item).unwrap_or_default(),
                item: i.item,
                quantity: i.quantity,
            })
            .collect(),
    }))
}

/// Replace your hand-maintained list of usual items (used in `manual` habit mode).
#[utoipa::path(put, path = "/v1/basket", request_body = Vec<BasketItemDto>, responses(
    (status = 200, body = BasketDto), (status = 400, description = "Unknown item, bad quantity or duplicate", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn put_basket(
    State(state): State<AppState>,
    Json(items): Json<Vec<BasketItemDto>>,
) -> Result<Json<BasketDto>, ApiError> {
    let mut seen = HashSet::new();
    for i in &items {
        if by_key(&i.item).is_none() {
            return Err(ApiError::BadRequest(format!("unknown item {:?}", i.item)));
        }
        if !(1..=99).contains(&i.quantity) {
            return Err(ApiError::BadRequest(format!(
                "quantity of {:?} must be 1 to 99",
                i.item
            )));
        }
        if !seen.insert(i.item.clone()) {
            return Err(ApiError::BadRequest(format!(
                "item {:?} appears twice",
                i.item
            )));
        }
    }
    let items: Vec<BasketItem> = items
        .into_iter()
        .map(|i| BasketItem {
            item: i.item,
            quantity: i.quantity,
        })
        .collect();
    state.store.set_usual_items(&items).await?;
    get_basket(State(state)).await
}

// ---- receipts ----

fn receipt_dto(id: Option<i64>, duplicate: bool, r: ParsedReceipt) -> ReceiptDto {
    ReceiptDto {
        id,
        duplicate,
        merchant: r.merchant,
        chain: r.chain,
        date: r.date,
        total_cents: r.total,
        reconciles: r.reconciles,
        items: r
            .items
            .into_iter()
            .map(|i| ReceiptItemDto {
                text: i.text,
                quantity: i.quantity,
                line_total_cents: i.line_total,
                item: i.item,
            })
            .collect(),
    }
}

/// Upload text recognised from a receipt photo. Your usual items are learned from receipts
/// when the habit mode is `receipts`.
#[utoipa::path(post, path = "/v1/receipts", request_body = ReceiptUpload, responses(
    (status = 200, body = ReceiptDto), (status = 400, description = "No items recognised", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn upload_receipt(
    State(state): State<AppState>,
    Json(up): Json<ReceiptUpload>,
) -> Result<Json<ReceiptDto>, ApiError> {
    store_receipt_text(&state, &up.text).await.map(Json)
}

/// Parse receipt text and store it unless it is a duplicate or shows no items.
async fn store_receipt_text(state: &AppState, text: &str) -> Result<ReceiptDto, ApiError> {
    if text.len() > 20_000 {
        return Err(ApiError::BadRequest(
            "receipt text is longer than 20000 characters".into(),
        ));
    }
    let parsed = parse_receipt(text);
    if parsed.items.is_empty() {
        return Err(ApiError::BadRequest(
            "no items recognised on this receipt".into(),
        ));
    }
    let fingerprint: String = Sha256::digest(
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .as_bytes(),
    )
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect();
    let json = serde_json::to_string(&parsed).map_err(|_| ApiError::Internal)?;
    let id = state
        .store
        .add_receipt(&fingerprint, parsed.date, parsed.merchant.as_deref(), &json)
        .await?;
    Ok(receipt_dto(id, id.is_none(), parsed))
}

const SCAN_SYSTEM: &str = "You transcribe photos of shop receipts. Output only the text printed on the receipt, \
one receipt line per output line, in reading order. Keep item names, prices, quantity lines such as \
'2 x 0,99', the total (SUMME) and the date exactly as printed. Do not summarise, translate or add commentary. \
If the image is not a receipt, answer with the single word NONE.";

/// Largest photo accepted (decoded bytes).
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

/// Scan a receipt photo: a vision-capable model (Claude or OpenAI, as configured) transcribes it
/// and the transcript is parsed like pasted text. The photo is sent to that provider.
#[utoipa::path(post, path = "/v1/receipts/scan", request_body = ReceiptScan, responses(
    (status = 200, body = ScanDto),
    (status = 400, description = "Not a usable image, or no items found on it", body = ErrorBody),
    (status = 502, description = "The provider failed or cannot read images", body = ErrorBody),
    (status = 503, description = "No API key configured", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn scan_receipt(
    State(state): State<AppState>,
    Json(scan): Json<ReceiptScan>,
) -> Result<Json<ScanDto>, ApiError> {
    if !["image/jpeg", "image/png", "image/webp"].contains(&scan.mime_type.as_str()) {
        return Err(ApiError::BadRequest(
            "mime_type must be image/jpeg, image/png or image/webp".into(),
        ));
    }
    let b64 = scan.image_base64.trim();
    // base64 inflates by 4/3; reject before decoding anything
    if b64.is_empty() || b64.len() > MAX_IMAGE_BYTES / 3 * 4 + 8 {
        return Err(ApiError::BadRequest(
            "image is empty or larger than 8 MB".into(),
        ));
    }
    if !b64
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'/' | b'='))
    {
        return Err(ApiError::BadRequest(
            "image_base64 is not valid base64".into(),
        ));
    }

    let llm = build_llm(&state).await?;
    let text = llm
        .describe_image(
            SCAN_SYSTEM,
            "Transcribe this receipt.",
            &scan.mime_type,
            b64,
        )
        .await
        .map_err(|e| match e {
            financer_llm::LlmError::Unsupported => ApiError::BadGateway(
                "the selected model cannot read images; choose another model in Settings".into(),
            ),
            other => ApiError::BadGateway(other.to_string().chars().take(300).collect()),
        })?;
    if text.trim().eq_ignore_ascii_case("none") {
        return Err(ApiError::BadRequest(
            "that does not look like a receipt".into(),
        ));
    }
    let receipt = store_receipt_text(&state, &text).await?;
    Ok(Json(ScanDto { text, receipt }))
}

#[utoipa::path(get, path = "/v1/receipts", responses((status = 200, body = Vec<ReceiptDto>)), security(("bearer" = [])))]
pub async fn list_receipts(
    State(state): State<AppState>,
) -> Result<Json<Vec<ReceiptDto>>, ApiError> {
    Ok(Json(
        state
            .store
            .list_receipts()
            .await?
            .into_iter()
            .filter_map(|r| {
                serde_json::from_str::<ParsedReceipt>(&r.json)
                    .ok()
                    .map(|p| receipt_dto(Some(r.id), false, p))
            })
            .collect(),
    ))
}

#[utoipa::path(delete, path = "/v1/receipts/{id}", params(("id" = i64, Path, description = "Receipt id")), responses(
    (status = 204, description = "Deleted"), (status = 404, description = "No such receipt", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn delete_receipt(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    if state.store.delete_receipt(id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

// ---- what can I buy ----

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct AffordQuery {
    /// Budget in cents. Default: what is left of this month's groceries limit.
    budget_cents: Option<i64>,
    /// Days one basket lasts (default 7).
    days_per_basket: Option<u32>,
}

/// What the budget buys: how long your usual basket lasts per chain, the cheapest items that
/// fit, and the cheapest way to split the shopping.
#[utoipa::path(get, path = "/v1/affordability", params(AffordQuery), responses(
    (status = 200, body = AffordabilityDto),
    (status = 400, description = "No budget given and no groceries limit set", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn affordability(
    State(state): State<AppState>,
    Query(q): Query<AffordQuery>,
) -> Result<Json<AffordabilityDto>, ApiError> {
    let (budget, budget_source) = match q.budget_cents {
        Some(c) if c < 0 => {
            return Err(ApiError::BadRequest(
                "budget_cents must not be negative".into(),
            ))
        }
        Some(c) => (Money::from_cents(c), "request"),
        None => {
            let envelopes = state.store.load_budget().await?;
            if !envelopes.envelopes.contains_key(&Category::Groceries) {
                return Err(ApiError::BadRequest(
                    "set a groceries limit in the budget or pass budget_cents".into(),
                ));
            }
            let txs: Vec<_> = state
                .store
                .list_transactions()
                .await?
                .into_iter()
                .map(|s| s.transaction)
                .collect();
            (
                envelopes.remaining(Category::Groceries, &txs, YearMonth::of(today())),
                "groceries_envelope",
            )
        }
    };
    let days = q.days_per_basket.unwrap_or(7).clamp(1, 60);
    let (basket, basket_source) = effective_basket(&state).await?;
    let quotes = plain_quotes(&live_quotes(&state).await?);

    let a = what_can_i_buy(budget, &basket, &quotes, days);
    let plan = plan_shopping(&basket, &quotes, Money::from_cents(MIN_PLAN_SAVING_CENTS)).map(|p| {
        let mut stops: BTreeMap<_, Vec<PickDto>> = BTreeMap::new();
        for (chain, picks) in p.stops {
            stops.insert(chain, picks.into_iter().map(pick_dto).collect());
        }
        PlanDto {
            stops: stops
                .into_iter()
                .map(|(chain, items)| PlanStopDto { chain, items })
                .collect(),
            total_cents: p.total,
            single_chain_total_cents: p.single_chain_total,
        }
    });
    Ok(Json(AffordabilityDto {
        budget_cents: budget,
        budget_source: budget_source.into(),
        basket_source: basket_source.into(),
        per_chain: a
            .per_chain
            .into_iter()
            .map(|c| ChainAffordabilityDto {
                chain: c.chain,
                basket_cents: c.basket_total,
                baskets: c.baskets,
                days_covered: c.days_covered,
                missing: c.missing,
            })
            .collect(),
        staples: a
            .staples
            .into_iter()
            .take(20)
            .map(|s| StapleDto {
                name: item_name(&s.item),
                item: s.item,
                chain: s.chain,
                price_cents: s.price,
                max_packs: s.max_packs,
            })
            .collect(),
        plan,
    }))
}

// ---- recipes ----

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct RecipeQuery {
    /// Hide recipes whose missing ingredients cost more than this.
    budget_cents: Option<i64>,
    /// Only recipes with this tag, e.g. `vegetarisch`.
    tag: Option<String>,
    /// At most this many (default 10, max 50).
    limit: Option<usize>,
}

/// Bundled recipes ranked by how much of them you already buy, what is on offer and what the
/// rest costs.
#[utoipa::path(get, path = "/v1/recipes", params(RecipeQuery), responses((status = 200, body = Vec<RecipeMatchDto>)),
    security(("bearer" = [])))]
pub async fn recipes(
    State(state): State<AppState>,
    Query(q): Query<RecipeQuery>,
) -> Result<Json<Vec<RecipeMatchDto>>, ApiError> {
    let (basket, _) = effective_basket(&state).await?;
    let stored = live_quotes(&state).await?;
    let quotes = plain_quotes(&stored);
    let usual: HashSet<String> = basket.into_iter().map(|b| b.item).collect();
    let on_offer: HashSet<String> = quotes
        .iter()
        .filter(|q| q.is_offer)
        .map(|q| q.item.clone())
        .collect();
    let input = MatchInput {
        usual: &usual,
        on_offer: &on_offer,
        quotes: &quotes,
        budget: q.budget_cents.filter(|c| *c >= 0).map(Money::from_cents),
        tag: q.tag.as_deref(),
    };
    let ranked = rank_recipes(bundled(), &input);
    Ok(Json(
        ranked
            .into_iter()
            .take(q.limit.unwrap_or(10).clamp(1, 50))
            .map(|m| RecipeMatchDto {
                id: m.recipe.id,
                title: m.recipe.title,
                minutes: m.recipe.minutes,
                servings: m.recipe.servings,
                tags: m.recipe.tags,
                ingredients: m
                    .recipe
                    .ingredients
                    .into_iter()
                    .map(|i| RecipeIngredientDto {
                        name: item_name(&i.item),
                        item: i.item,
                        amount: i.amount,
                    })
                    .collect(),
                steps: m.recipe.steps,
                coverage_percent: m.coverage_percent,
                have: m.have,
                missing: m.missing,
                on_offer: m.on_offer,
                missing_cost_cents: m.missing_cost,
                unpriced: m.unpriced,
            })
            .collect(),
    ))
}

fn parse_provider(s: &str) -> Option<Provider> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

async fn llm_settings(state: &AppState) -> Result<(Provider, String), ApiError> {
    let provider = state
        .store
        .get_setting("llm_provider")
        .await?
        .and_then(|p| parse_provider(&p))
        .unwrap_or(Provider::Claude);
    let model = state
        .store
        .get_setting("llm_model")
        .await?
        .unwrap_or_default();
    Ok((provider, model))
}

fn key_for(state: &AppState, provider: Provider) -> Option<String> {
    match provider {
        Provider::Claude => state.llm_keys.claude.clone(),
        Provider::OpenAi => state.llm_keys.openai.clone(),
    }
    .filter(|k| !k.trim().is_empty())
}

/// The configured provider, or `503` with what to set when its key is missing.
async fn build_llm(state: &AppState) -> Result<Box<dyn financer_llm::LlmProvider>, ApiError> {
    let (provider, model) = llm_settings(state).await?;
    let Some(api_key) = key_for(state, provider) else {
        let var = if provider == Provider::Claude {
            "FINANCER_ANTHROPIC_API_KEY"
        } else {
            "FINANCER_OPENAI_API_KEY"
        };
        return Err(ApiError::Unavailable(format!(
            "no API key for {provider:?}; set {var} on the server"
        )));
    };
    (state.llm)(&LlmSettings {
        provider,
        model,
        api_key,
    })
    .map_err(|e| ApiError::Unavailable(e.to_string()))
}

/// New recipe ideas from Claude or OpenAI, based on your usual items and current offers. Only
/// item names, the budget and your diet note are sent, never bank data.
#[utoipa::path(post, path = "/v1/recipes/ideas", request_body = IdeasRequest, responses(
    (status = 200, body = Vec<IdeaDto>),
    (status = 503, description = "No API key configured for the selected provider", body = ErrorBody),
    (status = 502, description = "The provider failed or returned nothing usable", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn recipe_ideas(
    State(state): State<AppState>,
    Json(req): Json<IdeasRequest>,
) -> Result<Json<Vec<IdeaDto>>, ApiError> {
    let llm = build_llm(&state).await?;

    let (basket, _) = effective_basket(&state).await?;
    let quotes = live_quotes(&state).await?;
    let mut on_offer: Vec<String> = quotes
        .iter()
        .filter(|q| q.quote.is_offer)
        .map(|q| item_name(&q.quote.item))
        .collect();
    on_offer.sort();
    on_offer.dedup();
    let idea_req = IdeaRequest {
        usual_items: basket.iter().map(|b| item_name(&b.item)).collect(),
        on_offer,
        budget: req.budget_cents.filter(|c| *c >= 0).map(Money::from_cents),
        diet: req.diet,
        count: req.count.unwrap_or(3),
    };
    let ideas = generate_ideas(llm.as_ref(), &idea_req)
        .await
        .map_err(|e| match e {
            IdeaError::Llm(financer_llm::LlmError::MissingKey(_)) => {
                ApiError::Unavailable(e.to_string())
            }
            other => ApiError::BadGateway(other.to_string().chars().take(300).collect()),
        })?;
    Ok(Json(
        ideas
            .into_iter()
            .map(|i| IdeaDto {
                title: i.title,
                summary: i.summary,
                minutes: i.minutes,
                servings: i.servings,
                ingredients: i
                    .ingredients
                    .into_iter()
                    .map(|g| IdeaIngredientDto {
                        name: g.name,
                        amount: g.amount,
                    })
                    .collect(),
                steps: i.steps,
            })
            .collect(),
    ))
}

// ---- settings ----

#[utoipa::path(get, path = "/v1/settings", responses((status = 200, body = SettingsDto)), security(("bearer" = [])))]
pub async fn get_settings(State(state): State<AppState>) -> Result<Json<SettingsDto>, ApiError> {
    let (provider, model) = llm_settings(&state).await?;
    Ok(Json(SettingsDto {
        habit_mode: state
            .store
            .get_setting("habit_mode")
            .await?
            .unwrap_or_else(|| DEFAULT_HABIT_MODE.into()),
        llm_provider: serde_json::to_value(provider)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default(),
        llm_model: model,
        claude_key_configured: key_for(&state, Provider::Claude).is_some(),
        openai_key_configured: key_for(&state, Provider::OpenAi).is_some(),
        price_sources: state.price_sources.len(),
    }))
}

#[utoipa::path(put, path = "/v1/settings", request_body = SettingsUpdate, responses(
    (status = 200, body = SettingsDto), (status = 400, description = "Invalid value", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn put_settings(
    State(state): State<AppState>,
    Json(u): Json<SettingsUpdate>,
) -> Result<Json<SettingsDto>, ApiError> {
    if let Some(m) = &u.habit_mode {
        if !["manual", "receipts", "spending"].contains(&m.as_str()) {
            return Err(ApiError::BadRequest(
                "habit_mode must be manual, receipts or spending".into(),
            ));
        }
    }
    if let Some(p) = &u.llm_provider {
        if parse_provider(p).is_none() {
            return Err(ApiError::BadRequest(
                "llm_provider must be claude or open_ai".into(),
            ));
        }
    }
    if u.llm_model
        .as_deref()
        .is_some_and(|m| m.len() > 100 || m.chars().any(char::is_control))
    {
        return Err(ApiError::BadRequest(
            "llm_model is not a valid model name".into(),
        ));
    }
    if let Some(m) = u.habit_mode {
        state.store.set_setting("habit_mode", &m).await?;
    }
    if let Some(p) = u.llm_provider {
        state.store.set_setting("llm_provider", &p).await?;
    }
    if let Some(m) = u.llm_model {
        state.store.set_setting("llm_model", m.trim()).await?;
    }
    get_settings(State(state)).await
}
