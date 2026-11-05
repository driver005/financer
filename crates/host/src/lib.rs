//! The finance backend, assembled from its configuration.
//!
//! The server (`financer-server`) and the backend inside the phone (`financer-embedded`) are the
//! same program in two places, so they are built by the same code: this crate turns a
//! [`financer_config::Config`] into an [`AppState`] with the AI keys, the price sources, the bank
//! providers (FinTS, Plaid, GoCardless, finAPI), the receipt sources, the settings screen of the
//! app, and the background work (receipt import, bank syncs, price refresh). What differs between
//! the two is only what the host says in [`HostOptions`]: which API token the router wants, what
//! seals the stored logins, and what "restart" means.

use std::sync::Arc;
use std::time::Duration;

use financer_api::{Api, AppState, BankConnection, BankProvider, LlmKeys, PriceSourceConfig};
use financer_config::{Admin, Config, ProviderChoice};
use financer_core::StoreAlias;
use financer_prices::{PoliteHttp, ReqwestHttp};
use financer_store::Store;
use tokio::task::JoinHandle;

const USER_AGENT: &str =
    "financer-personal/0.1 (personal use; +https://github.com/driver005/financer)";
const AGENT_TOKEN: &str = "financer";
/// The pause between two requests to one retailer.
const REQUEST_GAP: Duration = Duration::from_secs(3);

/// The settings screen of the app and what applies a saved change.
pub type ConfigAdmin = (Arc<Admin>, Arc<dyn Fn() + Send + Sync>);

/// What the host decides, as opposed to the configuration.
pub struct HostOptions {
    /// Seals the bank access and the receipt sign-ins kept in the database. The server uses
    /// `FINANCER_SECRET_KEY`, or else its API token; the phone uses the secret its app keeps in
    /// secure storage. It must not change between starts.
    pub secret: String,
    /// The settings screen of the app (`/v1/server-config`) and what applies a saved change.
    /// `None` leaves the screen out.
    pub admin: Option<ConfigAdmin>,
}

/// The background work of one assembly. Dropping it stops the work, so a backend that is
/// rebuilt (the phone applying a changed setting) does not leave the old one running.
#[derive(Default)]
pub struct Tasks(Vec<JoinHandle<()>>);

impl Tasks {
    fn add(&mut self, handle: JoinHandle<()>) {
        self.0.push(handle);
    }
}

impl Drop for Tasks {
    fn drop(&mut self) {
        for t in &self.0 {
            t.abort();
        }
    }
}

/// The result of [`assemble`].
pub struct Assembled {
    pub state: AppState,
    /// The receipt import, when a source is switched on.
    pub receipts: Option<Arc<financer_receipt_sources::ReceiptSyncer>>,
    /// How many price sources are configured.
    pub price_sources: usize,
    pub tasks: Tasks,
}

/// The secret value of a setting, when it has one.
pub fn secret(s: &financer_config::Setting<Option<financer_config::Secret>>) -> Option<String> {
    s.value.as_ref().map(|k| k.expose().to_string())
}

/// The price sources of the configuration: the file it names, and the ones written in it.
pub fn load_sources(config: &Config) -> Result<Vec<PriceSourceConfig>, String> {
    let mut sources = Vec::new();
    if let Some(path) = config.prices.sources_file.value.clone() {
        let text = std::fs::read_to_string(&path).map_err(|e| {
            format!(
                "cannot read the price sources file {path} ({}): {e}",
                config.prices.sources_file.source
            )
        })?;
        let from_file: Vec<PriceSourceConfig> = serde_json::from_str(&text)
            .map_err(|e| format!("invalid price sources in {path}: {e}"))?;
        sources.extend(from_file);
    }
    sources.extend(config.prices.sources.iter().cloned());
    Ok(sources)
}

/// An HTTP client that waits between requests to one host.
pub fn polite_http() -> Result<Arc<PoliteHttp<ReqwestHttp>>, String> {
    let inner = ReqwestHttp::new(USER_AGENT).map_err(|e| e.to_string())?;
    Ok(Arc::new(PoliteHttp::new(inner, AGENT_TOKEN, REQUEST_GAP)))
}

fn llm_provider(choice: ProviderChoice) -> financer_llm::Provider {
    match choice {
        ProviderChoice::Claude => financer_llm::Provider::Claude,
        ProviderChoice::OpenAi => financer_llm::Provider::OpenAi,
    }
}

/// The store aliases of the configuration (`[[stores]]`).
pub fn store_aliases(config: &Config) -> Vec<StoreAlias> {
    config
        .stores
        .iter()
        .map(|s| StoreAlias {
            chain: s.chain.clone(),
            patterns: s.patterns.to_vec(),
        })
        .collect()
}

fn bank_connections(config: &Config) -> Vec<BankConnection> {
    config
        .bank
        .accounts
        .iter()
        .map(|a| BankConnection {
            name: a.name.trim().to_string(),
            kind: BankProvider::parse(&a.kind).unwrap_or(BankProvider::Fints),
            institution: a
                .institution
                .as_ref()
                .map(|i| i.trim().to_string())
                .filter(|i| !i.is_empty()),
            account_ids: a
                .account_ids
                .iter()
                .map(|id| id.trim().to_string())
                .collect(),
            bank_code: a.bank_code.trim().to_string(),
            login: a.login.trim().to_string(),
            iban: a.iban.split_whitespace().collect(),
            bic: a.bic.clone().filter(|b| !b.trim().is_empty()),
            fints_url: a.fints_url.clone().filter(|u| !u.trim().is_empty()),
            pin_env: a.pin_env.clone().filter(|v| !v.trim().is_empty()),
            sync_every_hours: a.sync_every_hours,
            since_days: a.since_days,
        })
        .collect()
}

/// Build the backend from `config` on `store`, and start its background work. Must run inside a
/// Tokio runtime.
pub async fn assemble(
    config: &Config,
    store: Store,
    options: HostOptions,
) -> Result<Assembled, String> {
    let sources = load_sources(config)?;
    let refresh_hours = config.server.refresh_hours.value;
    let receipt_store = store.clone();
    let mut tasks = Tasks::default();

    let mut state = AppState::new(store)
        .with_http(polite_http()?)
        .with_price_sources(sources.clone())
        .with_llm_keys(LlmKeys {
            claude: secret(&config.llm.anthropic_api_key),
            openai: secret(&config.llm.openai_api_key),
        })
        .with_default_llm_provider(config.llm.provider.value.map(llm_provider))
        .with_store_aliases(&store_aliases(config))
        .with_bank_connections(bank_connections(config));
    if let Some((admin, restart)) = options.admin {
        // the settings screen of the app: a saved change applies by restarting
        state = state.with_config_admin(admin, move || restart());
    }

    if let Some(product_id) = secret(&config.bank.fints_product_id) {
        state = state.with_bank(Arc::new(financer_openbanking::fints::FintsBank::new(
            &product_id,
        )));
        tracing::info!("live bank sync enabled (FinTS)");
    }

    // Plaid, GoCardless and finAPI: you sign in once on the provider's page and the access it
    // hands over is kept sealed with the host's secret
    let wanted = |kind: &str| config.bank.accounts.iter().any(|a| a.kind == kind);
    let (plaid_wanted, gocardless_wanted, finapi_wanted) =
        (wanted("plaid"), wanted("gocardless"), wanted("finapi"));
    if config.bank.plaid.configured()
        || config.bank.gocardless.configured()
        || config.bank.finapi.configured()
    {
        state = state.with_secret_box(
            financer_receipt_sources::SecretBox::new(&options.secret)
                .map_err(|e| format!("cannot keep the bank access safe: {e}"))?,
        );
    }
    let http: Arc<dyn financer_openbanking::OpenHttp> = Arc::new(
        financer_openbanking::ReqwestHttp::new()
            .map_err(|e| format!("cannot start the bank client: {e}"))?,
    );
    if config.bank.plaid.configured() {
        let environment =
            financer_openbanking::PlaidEnvironment::parse(&config.bank.plaid.environment.value)
                .ok_or("bank.plaid.environment is not known")?;
        let client = financer_openbanking::plaid::PlaidClient::new(
            financer_openbanking::PlaidConfig::new(
                secret(&config.bank.plaid.client_id).unwrap_or_default(),
                secret(&config.bank.plaid.secret).unwrap_or_default(),
                environment,
            ),
            http.clone(),
        );
        state = state.with_provider(Arc::new(financer_openbanking::PlaidProvider::new(
            client,
            config.bank.plaid.country_codes.clone(),
            config.bank.plaid.language.clone(),
            config.bank.plaid.redirect_uri.clone(),
        )));
        tracing::info!(
            "Plaid enabled ({}){}",
            environment.name(),
            if environment == financer_openbanking::PlaidEnvironment::Sandbox {
                ": test bank only"
            } else {
                ""
            }
        );
    } else if plaid_wanted {
        tracing::warn!(
            "bank accounts with kind \"plaid\" are configured but bank.plaid is not, so they cannot sync"
        );
    }
    if config.bank.gocardless.configured() {
        let mut cfg = financer_openbanking::GoCardlessConfig::new(
            secret(&config.bank.gocardless.secret_id).unwrap_or_default(),
            secret(&config.bank.gocardless.secret_key).unwrap_or_default(),
        );
        cfg.language = config.bank.gocardless.language.clone();
        cfg.redirect_uri = config.bank.gocardless.redirect_uri.clone();
        state = state.with_provider(Arc::new(financer_openbanking::GoCardless::new(
            cfg,
            http.clone(),
        )));
        tracing::info!("GoCardless enabled");
    } else if gocardless_wanted {
        tracing::warn!(
            "bank accounts with kind \"gocardless\" are configured but bank.gocardless is not, so they cannot sync"
        );
    }
    if config.bank.finapi.configured() {
        let environment =
            financer_openbanking::FinapiEnvironment::parse(&config.bank.finapi.environment.value)
                .ok_or("bank.finapi.environment is not known")?;
        let mut cfg = financer_openbanking::FinapiConfig::new(
            secret(&config.bank.finapi.client_id).unwrap_or_default(),
            secret(&config.bank.finapi.client_secret).unwrap_or_default(),
            environment,
        );
        cfg.redirect_uri = config.bank.finapi.redirect_uri.clone();
        state = state.with_provider(Arc::new(financer_openbanking::Finapi::new(cfg, http)));
        tracing::info!(
            "finAPI enabled ({}){}",
            environment.name(),
            if environment == financer_openbanking::FinapiEnvironment::Sandbox {
                ": test banks only"
            } else {
                ""
            }
        );
    } else if finapi_wanted {
        tracing::warn!(
            "bank accounts with kind \"finapi\" are configured but bank.finapi is not, so they cannot sync"
        );
    }

    // automatic receipt import (mailbox, Lidl Plus, Kaufland Card, watched folder) from [receipts]
    let receipts = financer_receipt_sources::ReceiptSyncer::for_device(
        receipt_store,
        config.receipts.value.clone(),
        &options.secret,
        &store_aliases(config),
    )?;
    match &receipts {
        Some(syncer) => {
            tracing::info!("receipt sources enabled ({})", config.receipts.source);
            state = state.with_receipt_syncer(syncer.clone());
            tasks.add(tokio::spawn(syncer.clone().run()));
        }
        None => tracing::info!("no receipt source is enabled"),
    }

    if !config.bank.accounts.is_empty() {
        let fints_ready = secret(&config.bank.fints_product_id).is_some();
        let fints_wanted = config.bank.accounts.iter().any(|a| a.kind == "fints");
        if fints_wanted && !fints_ready {
            tracing::warn!(
                "bank accounts with kind \"fints\" are configured but there is no FinTS product id, so they cannot sync"
            );
        }
        if (fints_wanted && fints_ready)
            || (plaid_wanted && config.bank.plaid.configured())
            || (gocardless_wanted && config.bank.gocardless.configured())
            || (finapi_wanted && config.bank.finapi.configured())
        {
            tracing::info!(
                "{} bank connection(s) from the configuration; FinTS syncs wait for your approval in the banking app, Plaid, GoCardless and finAPI syncs run by themselves once linked",
                config.bank.accounts.len()
            );
            tasks.add(tokio::spawn(Api::run_bank_scheduler(state.clone())));
        }
    }

    if refresh_hours > 0 && !sources.is_empty() {
        let state = state.clone();
        tasks.add(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            loop {
                match Api::refresh_prices_summary(&state).await {
                    Ok(summary) => tracing::info!("price refresh: {summary}"),
                    Err(e) => tracing::warn!("price refresh failed: {e}"),
                }
                tokio::time::sleep(Duration::from_secs(refresh_hours * 3600)).await;
            }
        }));
    }

    Ok(Assembled {
        state,
        receipts,
        price_sources: sources.len(),
        tasks,
    })
}
