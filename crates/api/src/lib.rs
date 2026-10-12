//! REST API shared by the hosted server and the embedded on-phone backend.

mod auth;
mod bank;
mod budget_period;
mod categorization;
mod dto;
mod export;
mod grocery;
mod mealplan;
mod routes;
mod watchdog;

use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, post, put};
use axum::Router;
use financer_fints::{BankClient, UnconfiguredBank};
use financer_llm::{LlmError, LlmProvider, LlmSettings, ProviderFactory};
use financer_prices::{Http, HttpResponse, PriceError, SourceConfig};
use financer_store::Store;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

pub use auth::TokenHash;
pub use financer_fints::{BankClient as BankClientTrait, BankData, BankError, MockBank};
pub use financer_llm::MockProvider;
pub use financer_prices::{FakeHttp, SourceConfig as PriceSourceConfig};

/// Largest request body accepted (CSV exports of many years stay well below this).
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

/// API keys for the LLM providers. They live on the server (environment), never in the app.
#[derive(Clone, Default)]
pub struct LlmKeys {
    pub claude: Option<String>,
    pub openai: Option<String>,
}

type LlmFactory = Arc<dyn Fn(&LlmSettings) -> Result<Box<dyn LlmProvider>, LlmError> + Send + Sync>;

/// Used until a real HTTP client is configured, so a misconfigured server fails loudly
/// instead of silently fetching nothing.
struct NoNetwork;

#[async_trait]
impl Http for NoNetwork {
    async fn get(&self, _url: &str) -> Result<HttpResponse, PriceError> {
        Err(PriceError::Http(
            "network access for price sources is not configured".into(),
        ))
    }
}

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub(crate) bank: Arc<dyn BankClient>,
    pub(crate) bank_configured: bool,
    pub(crate) pending_sync: Arc<tokio::sync::Mutex<Option<bank::PendingEntry>>>,
    pub(crate) sync_ttl: std::time::Duration,
    pub(crate) pin_guard: Arc<tokio::sync::Mutex<bank::PinGuard>>,
    pub(crate) pin_pause: std::time::Duration,
    pub(crate) http: Arc<dyn Http>,
    pub(crate) price_sources: Arc<Vec<SourceConfig>>,
    pub(crate) llm_keys: LlmKeys,
    pub(crate) llm: LlmFactory,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            bank: Arc::new(UnconfiguredBank),
            bank_configured: false,
            pending_sync: Arc::new(tokio::sync::Mutex::new(None)),
            sync_ttl: bank::DEFAULT_SYNC_TTL,
            pin_guard: Arc::new(tokio::sync::Mutex::new(bank::PinGuard::default())),
            pin_pause: bank::DEFAULT_PIN_PAUSE,
            http: Arc::new(NoNetwork),
            price_sources: Arc::new(Vec::new()),
            llm_keys: LlmKeys::default(),
            llm: Arc::new(ProviderFactory::create),
        }
    }

    /// The bank client used for live sync (the server passes the real FinTS client).
    pub fn with_bank(mut self, bank: Arc<dyn BankClient>) -> Self {
        self.bank = bank;
        self.bank_configured = true;
        self
    }

    /// How long syncing pauses after repeated wrong PINs (tests shorten it).
    pub fn with_pin_pause(mut self, pause: std::time::Duration) -> Self {
        self.pin_pause = pause;
        self
    }

    /// How long a started sync may wait for approval.
    pub fn with_sync_ttl(mut self, ttl: std::time::Duration) -> Self {
        self.sync_ttl = ttl;
        self
    }

    /// HTTP client used for price refreshes (the server passes a polite, robots-aware one).
    pub fn with_http(mut self, http: Arc<dyn Http>) -> Self {
        self.http = http;
        self
    }

    pub fn with_price_sources(mut self, sources: Vec<SourceConfig>) -> Self {
        self.price_sources = Arc::new(sources);
        self
    }

    pub fn with_llm_keys(mut self, keys: LlmKeys) -> Self {
        self.llm_keys = keys;
        self
    }

    /// Replace how LLM providers are built (tests use a mock).
    pub fn with_llm_factory(mut self, factory: LlmFactory) -> Self {
        self.llm = factory;
        self
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Financer API", version = "0.1.0"),
    paths(
        routes::health,
        routes::import_transactions,
        routes::list_transactions,
        routes::recurring,
        routes::disposable,
        routes::get_envelopes,
        routes::put_envelopes,
        routes::budget_status,
        budget_period::budget_period,
        budget_period::safe_to_spend,
        export::export_data,
        export::import_data,
        bank::start_sync,
        bank::confirm_sync,
        bank::bank_status,
        grocery::refresh_prices,
        grocery::list_prices,
        grocery::best_prices,
        grocery::catalog,
        grocery::get_basket,
        grocery::put_basket,
        grocery::upload_receipt,
        grocery::scan_receipt,
        grocery::list_receipts,
        grocery::delete_receipt,
        grocery::affordability,
        grocery::recipes,
        grocery::recipe_ideas,
        grocery::get_settings,
        grocery::put_settings,
        categorization::list_rules,
        categorization::create_rule,
        categorization::update_rule,
        categorization::delete_rule,
        categorization::reorder_rules,
        categorization::apply_rules,
        categorization::set_category,
        categorization::list_splits,
        categorization::put_split,
        categorization::delete_split,
        categorization::categorize_unknown,
        categorization::accept_suggestions,
        watchdog::subscriptions,
        watchdog::alerts,
        watchdog::dismiss_alert,
        mealplan::get_meal_plan,
        mealplan::put_meal_plan,
        mealplan::get_shopping_list,
        mealplan::get_pantry,
        mealplan::put_pantry,
    ),
    components(schemas(
        dto::TransactionDto,
        dto::ImportReport,
        dto::SkippedRowDto,
        dto::RecurringDto,
        dto::EnvelopeDto,
        dto::EnvelopeStatusDto,
        dto::DisposableDto,
        budget_period::PeriodChoice,
        budget_period::PeriodDto,
        budget_period::SafeToSpendDto,
        dto::ErrorBody,
        dto::ExportTransaction,
        dto::ExportReceipt,
        dto::ExportSettings,
        dto::ExportDto,
        dto::ImportReportDto,
        dto::SyncRequest,
        dto::SyncStarted,
        dto::SyncDone,
        dto::BankStatus,
        dto::PriceDto,
        dto::SourceStatusDto,
        dto::RefreshReportDto,
        dto::BasketItemDto,
        dto::BasketDto,
        dto::BasketItemOutDto,
        dto::CatalogItemDto,
        dto::ReceiptUpload,
        dto::ReceiptItemDto,
        dto::ReceiptDto,
        dto::ReceiptScan,
        dto::ScanDto,
        dto::ChainAffordabilityDto,
        dto::StapleDto,
        dto::PlanStopDto,
        dto::PickDto,
        dto::PlanDto,
        dto::AffordabilityDto,
        dto::RecipeMatchDto,
        dto::RecipeIngredientDto,
        dto::IdeasRequest,
        dto::IdeaDto,
        dto::IdeaIngredientDto,
        dto::SettingsDto,
        dto::SettingsUpdate,
        categorization::RuleDto,
        categorization::RuleInput,
        categorization::RuleOrder,
        categorization::ApplyReport,
        categorization::CategoryChange,
        categorization::CategoryChanged,
        categorization::SplitPartDto,
        categorization::SplitInput,
        categorization::SplitDto,
        categorization::SuggestionDto,
        categorization::SuggestionsDto,
        categorization::AcceptedSuggestion,
        categorization::AcceptSuggestions,
        categorization::AcceptReport,
        watchdog::SubscriptionDto,
        watchdog::UpcomingChargeDto,
        watchdog::PriceHikeDto,
        watchdog::DuplicateSubscriptionDto,
        watchdog::StaleSubscriptionDto,
        watchdog::SubscriptionsDto,
        watchdog::AlertDto,
        watchdog::AlertsDto,
        watchdog::AlertDismissedDto,
        mealplan::MealIngredientInput,
        mealplan::MealDayInput,
        mealplan::MealPlanInput,
        mealplan::MealIngredientDto,
        mealplan::MealDayDto,
        mealplan::MealPlanDto,
        mealplan::PantryItemDto,
        mealplan::PantryDto,
        mealplan::PantryUpdate,
        mealplan::ShoppingItemDto,
        mealplan::ShoppingStopDto,
        mealplan::ShoppingPlanDto,
        mealplan::ChainTotalDto,
        mealplan::UnmatchedDto,
        mealplan::MealBudgetDto,
        mealplan::ShoppingListDto,
    )),
    modifiers(&BearerAuth)
)]
pub struct ApiDoc;

struct BearerAuth;

impl utoipa::Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Bearer).build()),
        );
    }
}

/// Entry points that assemble and run the API.
pub struct Api;

impl Api {
    /// Build the router. `/health` is open; everything under `/v1` needs the bearer token.
    pub fn router(state: AppState, token: TokenHash) -> Router {
        let v1 = Router::new()
            .route("/transactions", get(routes::list_transactions))
            .route("/transactions/import", post(routes::import_transactions))
            .route("/recurring", get(routes::recurring))
            .route("/budget/disposable", get(routes::disposable))
            .route(
                "/budget/envelopes",
                get(routes::get_envelopes).put(routes::put_envelopes),
            )
            .route("/budget/status", get(routes::budget_status))
            .route("/budget/period", get(budget_period::budget_period))
            .route("/budget/safe-to-spend", get(budget_period::safe_to_spend))
            .route("/export", get(export::export_data))
            .route("/import", post(export::import_data))
            .route("/bank/sync", post(bank::start_sync))
            .route("/bank/sync/{id}/confirm", post(bank::confirm_sync))
            .route("/bank/status", get(bank::bank_status))
            .route("/prices", get(grocery::list_prices))
            .route("/prices/best", get(grocery::best_prices))
            .route("/prices/refresh", post(grocery::refresh_prices))
            .route("/catalog", get(grocery::catalog))
            .route("/basket", get(grocery::get_basket).put(grocery::put_basket))
            .route(
                "/receipts",
                get(grocery::list_receipts).post(grocery::upload_receipt),
            )
            .route(
                "/receipts/scan",
                post(grocery::scan_receipt).layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
            )
            .route("/receipts/{id}", delete(grocery::delete_receipt))
            .route("/affordability", get(grocery::affordability))
            .route("/recipes", get(grocery::recipes))
            .route("/recipes/ideas", post(grocery::recipe_ideas))
            .route(
                "/settings",
                get(grocery::get_settings).put(grocery::put_settings),
            )
            .route(
                "/rules",
                get(categorization::list_rules).post(categorization::create_rule),
            )
            .route("/rules/reorder", post(categorization::reorder_rules))
            .route("/rules/apply", post(categorization::apply_rules))
            .route(
                "/rules/{id}",
                put(categorization::update_rule).delete(categorization::delete_rule),
            )
            .route("/transactions/splits", get(categorization::list_splits))
            .route(
                "/transactions/categorize-unknown",
                post(categorization::categorize_unknown),
            )
            .route(
                "/transactions/categorize-unknown/accept",
                post(categorization::accept_suggestions),
            )
            .route(
                "/transactions/{id}/category",
                put(categorization::set_category),
            )
            .route(
                "/transactions/{id}/split",
                put(categorization::put_split).delete(categorization::delete_split),
            )
            .route("/subscriptions", get(watchdog::subscriptions))
            .route("/alerts", get(watchdog::alerts))
            .route("/alerts/{id}/dismiss", post(watchdog::dismiss_alert))
            .route(
                "/meal-plan",
                get(mealplan::get_meal_plan).put(mealplan::put_meal_plan),
            )
            .route("/meal-plan/shopping-list", get(mealplan::get_shopping_list))
            .route(
                "/meal-plan/pantry",
                get(mealplan::get_pantry).put(mealplan::put_pantry),
            )
            // An unknown API path is an API error, never a web page (see `Api::with_web_app`).
            .fallback(|| async { axum::http::StatusCode::NOT_FOUND })
            .layer(middleware::from_fn_with_state(
                token,
                auth::TokenAuth::require,
            ));

        Router::new()
            .route("/health", get(routes::health))
            .nest("/v1", v1)
            .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
            .layer(TraceLayer::new_for_http())
            .with_state(state)
    }

    /// Also serve a built web app (`expo export --platform web`) from `dir`: files as they are, and
    /// `index.html` for any other path so the app's own routes survive a reload. `/health` and
    /// `/v1` are untouched; an unknown `/v1` path is still an API error, never the web page.
    pub fn with_web_app(app: Router, dir: impl AsRef<std::path::Path>) -> Router {
        use tower_http::services::{ServeDir, ServeFile};
        let dir = dir.as_ref();
        app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))))
    }

    /// Refresh all configured price sources now. Returns a one-line summary for logs; used by the
    /// server's scheduler.
    pub async fn refresh_prices_summary(state: &AppState) -> Result<String, String> {
        match grocery::Grocery::refresh_prices_now(state).await {
            Ok(r) => {
                let failed: Vec<_> = r
                    .sources
                    .iter()
                    .filter(|s| !s.ok)
                    .map(|s| s.name.as_str())
                    .collect();
                Ok(format!(
                    "{} quotes stored, {} source(s) failed {:?}",
                    r.stored,
                    failed.len(),
                    failed
                ))
            }
            Err(routes::ApiError::Unavailable(m)) => Err(m),
            Err(_) => Err("price refresh failed".into()),
        }
    }

    pub fn openapi_json() -> String {
        ApiDoc::openapi()
            .to_pretty_json()
            .expect("OpenAPI document serializes")
    }
}
