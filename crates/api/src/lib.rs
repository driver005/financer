//! REST API shared by the hosted server and the embedded on-phone backend.

mod auth;
mod backup;
mod bank_connections;
mod budget_period;
mod calendar;
mod categorization;
mod dto;
mod export;
mod forecast;
mod grocery;
mod mealplan;
mod receipt_sources;
mod routes;
mod scan;
mod server_config;
mod stores;
mod watchdog;

use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, post, put};
use axum::Router;
use financer_core::{StoreAlias, StoreMatcher};
use financer_llm::{LlmError, LlmProvider, LlmSettings, ProviderFactory};
use financer_openbanking::fints::BankClient;
use financer_openbanking::{FintsProvider, Provider, Providers};
use financer_prices::{Http, HttpResponse, PriceError, SourceConfig};
use financer_store::Store;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

pub use auth::TokenHash;
pub use bank_connections::{BankConnection, BankProvider, ConnectionState};
pub use financer_llm::MockProvider;
pub use financer_openbanking::fints::{
    BankClient as BankClientTrait, BankData, BankError, MockBank,
};
pub use financer_openbanking::{ProviderKind, Providers as BankProviders};
pub use financer_prices::{FakeHttp, SourceConfig as PriceSourceConfig};

/// Largest request body accepted (CSV exports of many years stay well below this).
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

/// API keys for the LLM providers. They live on the server (environment), never in the app.
#[derive(Clone, Default)]
pub struct LlmKeys {
    pub claude: Option<String>,
    pub openai: Option<String>,
}

/// Reads a PIN from the environment variable of the given name.
type PinLookup = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

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
    /// Every way transactions come in that this server has set up (CSV import always).
    pub(crate) providers: Providers,
    /// The FinTS provider, kept to set how long a wrong PIN pauses syncing.
    pub(crate) fints: Option<Arc<FintsProvider>>,
    pub(crate) pin_pause: Option<std::time::Duration>,
    pub(crate) sync_ttl: std::time::Duration,
    pub(crate) bank_connections: Arc<bank_connections::Connections>,
    pub(crate) pin_lookup: PinLookup,
    pub(crate) secret_box: Option<Arc<financer_receipt_sources::SecretBox>>,
    pub(crate) connection_poll: std::time::Duration,
    pub(crate) http: Arc<dyn Http>,
    pub(crate) price_sources: Arc<Vec<SourceConfig>>,
    pub(crate) llm_keys: LlmKeys,
    pub(crate) default_llm_provider: Option<financer_llm::Provider>,
    pub(crate) store_matcher: Arc<StoreMatcher>,
    pub(crate) llm: LlmFactory,
    pub(crate) receipt_syncer: Option<Arc<financer_receipt_sources::ReceiptSyncer>>,
    pub(crate) config_control: Option<Arc<server_config::ConfigControl>>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            providers: Providers::new(),
            fints: None,
            pin_pause: None,
            sync_ttl: bank_connections::DEFAULT_SYNC_TTL,
            bank_connections: Arc::new(bank_connections::Connections::new(Vec::new())),
            pin_lookup: Arc::new(|var| std::env::var(var).ok().filter(|v| !v.is_empty())),
            secret_box: None,
            connection_poll: bank_connections::DEFAULT_POLL,
            http: Arc::new(NoNetwork),
            price_sources: Arc::new(Vec::new()),
            llm_keys: LlmKeys::default(),
            default_llm_provider: None,
            store_matcher: Arc::new(StoreMatcher::builtin()),
            llm: Arc::new(ProviderFactory::create),
            receipt_syncer: None,
            config_control: None,
        }
    }

    /// The server's configuration as a settings screen (`/v1/server-config`). `restart` is called
    /// a moment after a saved change, to apply it; the hosted server re-executes itself there.
    /// Without this the endpoints answer 404 (the on-phone backend has no configuration file).
    pub fn with_config_admin(
        mut self,
        admin: Arc<financer_config::Admin>,
        restart: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        self.config_control = Some(Arc::new(server_config::ConfigControl {
            admin,
            restart: Arc::new(restart),
            delay: server_config::DEFAULT_RESTART_DELAY,
            restarting: std::sync::atomic::AtomicBool::new(false),
        }));
        self
    }

    /// How long to wait between answering a saved change and restarting (tests shorten it).
    pub fn with_restart_delay(mut self, delay: std::time::Duration) -> Self {
        if let Some(control) = self.config_control.take() {
            self.config_control = Some(Arc::new(server_config::ConfigControl {
                admin: control.admin.clone(),
                restart: control.restart.clone(),
                delay,
                restarting: std::sync::atomic::AtomicBool::new(false),
            }));
        }
        self
    }

    /// The bank client used for FinTS (the server passes the real one).
    pub fn with_bank(mut self, bank: Arc<dyn BankClient>) -> Self {
        let fints = Arc::new(FintsProvider::new(bank));
        if let Some(pause) = self.pin_pause {
            fints.set_pin_pause(pause);
        }
        self.providers = self.providers.with(fints.clone());
        self.fints = Some(fints);
        self
    }

    /// How long syncing pauses after repeated wrong PINs (tests shorten it).
    pub fn with_pin_pause(mut self, pause: std::time::Duration) -> Self {
        self.pin_pause = Some(pause);
        if let Some(fints) = &self.fints {
            fints.set_pin_pause(pause);
        }
        self
    }

    /// A provider of transactions (Plaid, GoCardless, finAPI, or another FinTS client), set up by
    /// the server from its configuration. Plaid, GoCardless and finAPI need
    /// [`AppState::with_secret_box`] as well, because their access is kept sealed.
    pub fn with_provider(mut self, provider: Arc<dyn Provider>) -> Self {
        self.providers = self.providers.with(provider);
        self
    }

    /// The bank connections of the server configuration (`[[bank.accounts]]`). They sync with the
    /// providers set up here.
    pub fn with_bank_connections(mut self, connections: Vec<BankConnection>) -> Self {
        self.bank_connections = Arc::new(bank_connections::Connections::new(connections));
        self
    }

    /// Seals the secrets the server keeps (the Plaid, GoCardless and finAPI access) with a key derived from a
    /// server secret that is not in the database.
    pub fn with_secret_box(mut self, secrets: financer_receipt_sources::SecretBox) -> Self {
        self.secret_box = Some(Arc::new(secrets));
        self
    }

    /// How a connection's `pin_env` is looked up (tests use a fixed map instead of the
    /// environment).
    pub fn with_pin_lookup(
        mut self,
        lookup: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        self.pin_lookup = Arc::new(lookup);
        self
    }

    /// How often a started sync asks the bank whether you approved (tests shorten it).
    pub fn with_connection_poll(mut self, interval: std::time::Duration) -> Self {
        self.connection_poll = interval;
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

    /// The provider used until the app chooses one (the server's `[llm] provider` setting).
    pub fn with_default_llm_provider(mut self, provider: Option<financer_llm::Provider>) -> Self {
        self.default_llm_provider = provider;
        self
    }

    /// Your own spellings for supermarket chains (`[[stores]]` in the server configuration), added
    /// to the built-in table used for the spending-per-store report.
    pub fn with_store_aliases(mut self, aliases: &[StoreAlias]) -> Self {
        self.store_matcher = Arc::new(StoreMatcher::with_aliases(aliases));
        self
    }

    /// The automatic receipt sources (mailbox, Lidl Plus, Kaufland Card, watched folder). Without it the receipt
    /// source endpoints report every source as disabled.
    pub fn with_receipt_syncer(
        mut self,
        syncer: Arc<financer_receipt_sources::ReceiptSyncer>,
    ) -> Self {
        self.receipt_syncer = Some(syncer);
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
        routes::list_transactions,
        routes::recurring,
        routes::disposable,
        routes::get_envelopes,
        routes::put_envelopes,
        routes::budget_status,
        budget_period::budget_period,
        budget_period::safe_to_spend,
        forecast::forecast,
        export::export_data,
        export::import_data,
        backup::create_backup,
        backup::restore_backup,
        bank_connections::list_providers,
        bank_connections::list_connections,
        bank_connections::start_sync,
        bank_connections::get_sync,
        bank_connections::cancel_sync,
        bank_connections::disconnect_connection,
        bank_connections::import_file,
        bank_connections::bank_status,
        stores::store_spending,
        stores::store_transactions,
        grocery::refresh_prices,
        grocery::list_prices,
        grocery::best_prices,
        scan::ean_lookup,
        grocery::catalog,
        grocery::get_basket,
        grocery::put_basket,
        grocery::upload_receipt,
        grocery::scan_receipt,
        grocery::list_receipts,
        grocery::delete_receipt,
        receipt_sources::list_sources,
        receipt_sources::get_source,
        receipt_sources::sync_now,
        receipt_sources::connect_source,
        receipt_sources::finish_source,
        receipt_sources::disconnect_source,
        receipt_sources::known_receipts,
        receipt_sources::import_receipts,
        grocery::affordability,
        grocery::recipes,
        grocery::recipe_ideas,
        grocery::get_settings,
        grocery::put_settings,
        server_config::get_config,
        server_config::put_config,
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
        calendar::list_calendars,
        calendar::create_calendar,
        calendar::update_calendar,
        calendar::delete_calendar,
        calendar::list_events,
        calendar::get_event,
        calendar::create_event,
        calendar::update_event,
        calendar::delete_event,
        calendar::add_exception,
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
        forecast::ForecastDto,
        forecast::WarningLevelDto,
        forecast::WarningReasonDto,
        dto::ErrorBody,
        dto::ExportTransaction,
        dto::ExportReceipt,
        dto::ExportCalendar,
        dto::ExportEvent,
        calendar::EventBody,
        dto::ExportSettings,
        dto::ExportDto,
        dto::ImportReportDto,
        backup::BackupCreateRequest,
        backup::BackupDto,
        backup::BackupRestoreRequest,
        dto::BankStatus,
        bank_connections::ProviderDto,
        bank_connections::BankConnectionDto,
        bank_connections::SyncOutcomeDto,
        bank_connections::SyncRequest,
        bank_connections::LoginDto,
        bank_connections::SyncDto,
        bank_connections::ConnectionState,
        bank_connections::LinkedAccountDto,
        stores::StoresPeriod,
        stores::StoreSpendDto,
        stores::StoresDto,
        dto::PriceDto,
        scan::EanLookupDto,
        scan::ChainPriceDto,
        scan::ObservationDto,
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
        receipt_sources::ReceiptSourceDto,
        receipt_sources::ReceiptSyncDto,
        receipt_sources::ReceiptSyncRequest,
        receipt_sources::SourceConnectDto,
        receipt_sources::SourceFinishRequest,
        receipt_sources::ReceiptKnownRequest,
        receipt_sources::ReceiptKnownDto,
        receipt_sources::ReceiptLineInput,
        receipt_sources::ReceiptInput,
        receipt_sources::ReceiptImportRequest,
        receipt_sources::ReceiptImportDto,
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
        financer_config::ConfigView,
        financer_config::GroupView,
        financer_config::KeyView,
        financer_config::FieldView,
        financer_config::Change,
        server_config::ConfigSaved,
        server_config::ConfigProblems,
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
        calendar::CalendarDto,
        calendar::CalendarInput,
        calendar::RepeatDto,
        calendar::EventDto,
        calendar::EventInput,
        calendar::ExceptionInput,
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
        Self::router_with(state, token, Vec::new())
    }

    /// Like [`Api::router`], with more apps mounted under `/v1/<name>` (the shopping assistant in
    /// the bundled build). They sit behind the same bearer token, so one token opens everything.
    pub fn router_with(state: AppState, token: TokenHash, apps: Vec<(&str, Router)>) -> Router {
        let mut v1 = Router::new()
            .route("/transactions", get(routes::list_transactions))
            .route("/recurring", get(routes::recurring))
            .route("/budget/disposable", get(routes::disposable))
            .route(
                "/budget/envelopes",
                get(routes::get_envelopes).put(routes::put_envelopes),
            )
            .route("/budget/status", get(routes::budget_status))
            .route("/budget/period", get(budget_period::budget_period))
            .route("/budget/safe-to-spend", get(budget_period::safe_to_spend))
            .route("/forecast", get(forecast::forecast))
            .route("/export", get(export::export_data))
            .route("/import", post(export::import_data))
            .route("/backup/create", post(backup::create_backup))
            .route("/backup/restore", post(backup::restore_backup))
            .route("/bank/providers", get(bank_connections::list_providers))
            .route("/bank/connections", get(bank_connections::list_connections))
            .route(
                "/bank/connections/{name}/disconnect",
                post(bank_connections::disconnect_connection),
            )
            .route("/bank/sync", post(bank_connections::start_sync))
            .route("/bank/sync/{id}", get(bank_connections::get_sync))
            .route(
                "/bank/sync/{id}/cancel",
                post(bank_connections::cancel_sync),
            )
            .route("/bank/import/{kind}", post(bank_connections::import_file))
            .route("/bank/status", get(bank_connections::bank_status))
            .route("/spending/stores", get(stores::store_spending))
            .route(
                "/spending/stores/{chain}/transactions",
                get(stores::store_transactions),
            )
            .route("/prices", get(grocery::list_prices))
            .route("/prices/best", get(grocery::best_prices))
            .route("/prices/ean/{ean}", get(scan::ean_lookup))
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
            .route("/receipts/sources", get(receipt_sources::list_sources))
            .route("/receipts/sources/{kind}", get(receipt_sources::get_source))
            .route(
                "/receipts/sources/{kind}/connect",
                post(receipt_sources::connect_source),
            )
            .route(
                "/receipts/sources/{kind}/finish",
                post(receipt_sources::finish_source),
            )
            .route(
                "/receipts/sources/{kind}/disconnect",
                post(receipt_sources::disconnect_source),
            )
            .route(
                "/receipts/sources/{kind}/known",
                post(receipt_sources::known_receipts),
            )
            .route(
                "/receipts/sources/{kind}/import",
                post(receipt_sources::import_receipts),
            )
            .route("/receipts/sync", post(receipt_sources::sync_now))
            .route("/affordability", get(grocery::affordability))
            .route("/recipes", get(grocery::recipes))
            .route("/recipes/ideas", post(grocery::recipe_ideas))
            .route(
                "/settings",
                get(grocery::get_settings).put(grocery::put_settings),
            )
            .route(
                "/server-config",
                get(server_config::get_config).put(server_config::put_config),
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
                "/calendar/calendars",
                get(calendar::list_calendars).post(calendar::create_calendar),
            )
            .route(
                "/calendar/calendars/{id}",
                put(calendar::update_calendar).delete(calendar::delete_calendar),
            )
            .route(
                "/calendar/events",
                get(calendar::list_events).post(calendar::create_event),
            )
            .route(
                "/calendar/events/{id}",
                get(calendar::get_event)
                    .put(calendar::update_event)
                    .delete(calendar::delete_event),
            )
            .route(
                "/calendar/events/{id}/exceptions",
                post(calendar::add_exception),
            )
            .route(
                "/meal-plan",
                get(mealplan::get_meal_plan).put(mealplan::put_meal_plan),
            )
            .route("/meal-plan/shopping-list", get(mealplan::get_shopping_list))
            .route(
                "/meal-plan/pantry",
                get(mealplan::get_pantry).put(mealplan::put_pantry),
            );
        for (name, app) in apps {
            v1 = v1.nest_service(&format!("/{name}"), app);
        }
        let v1 = v1
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

    /// Start every configured bank connection whose schedule is due and whose PIN the server has;
    /// returns how many started. The server calls [`Api::run_bank_scheduler`]; this is the one
    /// step, for tests.
    pub async fn run_due_bank_syncs(state: &AppState) -> usize {
        bank_connections::BankSync::run_due(state).await
    }

    /// Runs forever, starting due bank syncs once a minute (returns at once without connections).
    pub async fn run_bank_scheduler(state: AppState) {
        bank_connections::BankSync::run_scheduler(state).await
    }

    pub fn openapi_json() -> String {
        ApiDoc::openapi()
            .to_pretty_json()
            .expect("OpenAPI document serializes")
    }
}
