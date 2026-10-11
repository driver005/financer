//! Wire types. Amounts are integer cents; dates are ISO-8601 (`2026-03-02`).

use financer_core::{Cadence, Category, EnvelopeStatus, Money, RecurringPayment, Transaction};
use financer_store::StoredTransaction;
use serde::{Deserialize, Serialize};
use time::Date;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct TransactionDto {
    pub id: i64,
    #[schema(value_type = String, format = Date, example = "2026-03-02")]
    pub booking_date: Date,
    /// Negative for money leaving the account.
    #[schema(value_type = i64, example = -2347)]
    pub amount_cents: Money,
    pub counterparty: String,
    pub purpose: String,
    pub counterparty_iban: Option<String>,
    #[schema(value_type = Option<String>, example = "groceries")]
    pub category: Option<Category>,
}

impl From<StoredTransaction> for TransactionDto {
    fn from(s: StoredTransaction) -> Self {
        let Transaction {
            booking_date,
            amount,
            counterparty,
            purpose,
            counterparty_iban,
            category,
        } = s.transaction;
        TransactionDto {
            id: s.id,
            booking_date,
            amount_cents: amount,
            counterparty,
            purpose,
            counterparty_iban,
            category,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportReport {
    /// Rows stored for the first time.
    pub imported: usize,
    /// Rows already stored (same date, amount, counterparty and purpose).
    pub duplicates: usize,
    /// Rows that could not be read, with the reason.
    pub skipped: Vec<SkippedRowDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SkippedRowDto {
    pub line: u64,
    pub reason: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringDto {
    pub counterparty: String,
    #[schema(value_type = i64)]
    pub amount_cents: Money,
    #[schema(value_type = String, example = "monthly")]
    pub cadence: Cadence,
    #[schema(value_type = String, format = Date)]
    pub last_date: Date,
    #[schema(value_type = String, format = Date)]
    pub next_expected: Date,
}

impl From<RecurringPayment> for RecurringDto {
    fn from(r: RecurringPayment) -> Self {
        RecurringDto {
            counterparty: r.counterparty,
            amount_cents: r.amount,
            cadence: r.cadence,
            last_date: r.last_date,
            next_expected: r.next_expected,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EnvelopeDto {
    #[schema(value_type = String, example = "groceries")]
    pub category: Category,
    #[schema(value_type = i64, example = 40000)]
    pub limit_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EnvelopeStatusDto {
    #[schema(value_type = String, example = "groceries")]
    pub category: Category,
    #[schema(value_type = i64)]
    pub limit_cents: Money,
    #[schema(value_type = i64)]
    pub spent_cents: Money,
    /// `limit - spent`; negative when overspent.
    #[schema(value_type = i64)]
    pub remaining_cents: Money,
}

impl From<EnvelopeStatus> for EnvelopeStatusDto {
    fn from(s: EnvelopeStatus) -> Self {
        EnvelopeStatusDto {
            category: s.category,
            limit_cents: s.limit,
            spent_cents: s.spent,
            remaining_cents: s.remaining,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DisposableDto {
    #[schema(value_type = i64)]
    pub monthly_income_cents: Money,
    #[schema(value_type = i64)]
    pub monthly_fixed_costs_cents: Money,
    #[schema(value_type = i64)]
    pub disposable_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
}

// ---- groceries: prices, basket, receipts, affordability, recipes, settings ----

use financer_core::{Chain, PriceQuote};

#[derive(Debug, Serialize, ToSchema)]
pub struct PriceDto {
    /// Catalog key, e.g. `milch`.
    pub item: String,
    pub item_name: String,
    /// Pack all prices of this item are normalised to, e.g. `1 l`.
    pub reference_pack: String,
    #[schema(value_type = String, example = "aldi")]
    pub chain: Chain,
    /// Price of the reference pack.
    #[schema(value_type = i64)]
    pub price_cents: Money,
    /// Price of the product as listed on the shelf.
    #[schema(value_type = i64)]
    pub shelf_price_cents: Money,
    pub product_name: String,
    pub is_offer: bool,
    #[schema(value_type = Option<String>, format = Date)]
    pub valid_until: Option<Date>,
    pub source: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SourceStatusDto {
    pub name: String,
    pub ok: bool,
    pub offers_found: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RefreshReportDto {
    pub sources: Vec<SourceStatusDto>,
    /// Quotes stored after this refresh.
    pub stored: usize,
    pub unmatched: usize,
    pub no_size: usize,
    pub size_mismatch: usize,
    pub bad_price: usize,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BasketItemDto {
    /// Catalog key, e.g. `milch`.
    pub item: String,
    /// Packs of the reference size per shopping period (1 to 99).
    pub quantity: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BasketDto {
    /// `manual`, `receipts` or `starter` (a generic basket used until habits are known).
    pub source: String,
    pub items: Vec<BasketItemOutDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BasketItemOutDto {
    pub item: String,
    pub name: String,
    pub reference_pack: String,
    pub quantity: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CatalogItemDto {
    pub key: String,
    pub name: String,
    pub reference_pack: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiptUpload {
    /// Text recognised from the receipt photo.
    pub text: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptItemDto {
    pub text: String,
    pub quantity: u32,
    #[schema(value_type = i64)]
    pub line_total_cents: Money,
    /// Catalog key when recognised.
    pub item: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptDto {
    pub id: Option<i64>,
    /// True if this exact receipt was uploaded before (nothing new was stored).
    pub duplicate: bool,
    pub merchant: Option<String>,
    #[schema(value_type = Option<String>, example = "rewe")]
    pub chain: Option<Chain>,
    #[schema(value_type = Option<String>, format = Date)]
    pub date: Option<Date>,
    pub items: Vec<ReceiptItemDto>,
    #[schema(value_type = Option<i64>)]
    pub total_cents: Option<Money>,
    /// Items add up to the printed total; if false, ask the user to check the receipt.
    pub reconciles: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ChainAffordabilityDto {
    #[schema(value_type = String, example = "lidl")]
    pub chain: Chain,
    #[schema(value_type = i64)]
    pub basket_cents: Money,
    /// Whole baskets the budget pays for.
    pub baskets: u32,
    pub days_covered: u32,
    /// Basket items this chain has no price for.
    pub missing: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StapleDto {
    pub item: String,
    pub name: String,
    #[schema(value_type = String)]
    pub chain: Chain,
    #[schema(value_type = i64)]
    pub price_cents: Money,
    pub max_packs: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanStopDto {
    #[schema(value_type = String)]
    pub chain: Chain,
    pub items: Vec<PickDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PickDto {
    pub item: String,
    pub name: String,
    #[schema(value_type = String)]
    pub chain: Chain,
    #[schema(value_type = i64)]
    pub price_cents: Money,
    pub is_offer: bool,
    #[schema(value_type = Option<String>, format = Date)]
    pub valid_until: Option<Date>,
    /// How much more the next-cheapest chain charges.
    #[schema(value_type = i64)]
    pub saving_vs_next_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanDto {
    pub stops: Vec<PlanStopDto>,
    #[schema(value_type = i64)]
    pub total_cents: Money,
    #[schema(value_type = Option<i64>)]
    pub single_chain_total_cents: Option<Money>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AffordabilityDto {
    #[schema(value_type = i64)]
    pub budget_cents: Money,
    /// `request` or `groceries_envelope`.
    pub budget_source: String,
    pub basket_source: String,
    pub per_chain: Vec<ChainAffordabilityDto>,
    /// Cheapest items that fit the budget (at most 20).
    pub staples: Vec<StapleDto>,
    /// Best way to buy the basket, if every item has a price somewhere.
    pub plan: Option<PlanDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecipeMatchDto {
    pub id: String,
    pub title: String,
    pub minutes: u32,
    pub servings: u32,
    pub tags: Vec<String>,
    pub ingredients: Vec<RecipeIngredientDto>,
    pub steps: Vec<String>,
    /// Share of the ingredients you already buy, 0 to 100.
    pub coverage_percent: u32,
    pub have: Vec<String>,
    pub missing: Vec<String>,
    pub on_offer: Vec<String>,
    /// Full-pack price of the missing ingredients that have a known price.
    #[schema(value_type = i64)]
    pub missing_cost_cents: Money,
    pub unpriced: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecipeIngredientDto {
    pub item: String,
    pub name: String,
    pub amount: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct IdeasRequest {
    pub count: Option<usize>,
    pub diet: Option<String>,
    pub budget_cents: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IdeaDto {
    pub title: String,
    pub summary: String,
    pub minutes: u32,
    pub servings: u32,
    pub ingredients: Vec<IdeaIngredientDto>,
    pub steps: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IdeaIngredientDto {
    pub name: String,
    pub amount: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SettingsDto {
    /// `manual`, `receipts` or `spending`.
    pub habit_mode: String,
    /// `claude` or `open_ai`.
    pub llm_provider: String,
    /// Empty means the provider's default model.
    pub llm_model: String,
    pub claude_key_configured: bool,
    pub openai_key_configured: bool,
    /// Number of configured price sources.
    pub price_sources: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SettingsUpdate {
    pub habit_mode: Option<String>,
    pub llm_provider: Option<String>,
    pub llm_model: Option<String>,
}

pub fn quote_dto(q: &financer_store::StoredQuote) -> PriceDto {
    let PriceQuote {
        item,
        chain,
        price,
        valid_until,
        is_offer,
    } = q.quote.clone();
    let info = financer_core::by_key(&item);
    PriceDto {
        item_name: info
            .map(|i| i.name_de.to_string())
            .unwrap_or_else(|| item.clone()),
        reference_pack: financer_core::reference_label(&item).unwrap_or_default(),
        item,
        chain,
        price_cents: price,
        shelf_price_cents: q.shelf_price,
        product_name: q.product_name.clone(),
        is_offer,
        valid_until,
        source: q.source.clone(),
    }
}

// ---- bank sync ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncRequest {
    /// Bank code (BLZ).
    pub blz: String,
    /// Online banking login name.
    pub user_id: String,
    /// Online banking PIN. Held in memory until you approve, never stored or logged.
    pub pin: String,
    pub iban: String,
    /// Leave empty to use the bank's own BIC.
    pub bic: Option<String>,
    /// Days of history to fetch (default 90, 1 to 365).
    pub days: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SyncStarted {
    pub sync_id: String,
    /// Text from the bank, e.g. "Bitte bestätigen Sie die Anfrage in Ihrer S-pushTAN-App".
    pub challenge: String,
    /// True if the bank needs no approval; confirm right away.
    pub no_tan_required: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SyncDone {
    pub imported: usize,
    pub duplicates: usize,
    /// Transactions left out (pending, or not in EUR).
    pub skipped: usize,
    #[schema(value_type = Option<i64>)]
    pub balance_cents: Option<Money>,
    #[schema(value_type = Option<String>, format = Date)]
    pub balance_date: Option<Date>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BankStatus {
    /// False until the server has a FinTS product id.
    pub configured: bool,
    /// Unix seconds of the last successful sync.
    pub last_sync_at: Option<i64>,
    #[schema(value_type = Option<i64>)]
    pub balance_cents: Option<Money>,
    #[schema(value_type = Option<String>, format = Date)]
    pub balance_date: Option<Date>,
    /// Non-secret details of the last sync, to prefill the form.
    pub blz: Option<String>,
    pub user_id: Option<String>,
    pub iban: Option<String>,
    pub bic: Option<String>,
}
