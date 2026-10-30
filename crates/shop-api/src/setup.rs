//! Turning settings into a running shopping service. Shared by the standalone server, the bundled
//! server and the on-phone backend, so all three behave alike.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use financer_llm::{LlmSettings, Provider, ProviderFactory};
use financer_prices::{Http, PoliteHttp, ReqwestHttp};
use financer_shop_sources::{parse_sources, Crawler, LlmReader, SourceConfig};
use financer_shop_store::ShopStore;

use crate::notify::{ExpoNotifier, Notifier, NtfyNotifier, Poster, ReqwestPoster, WebhookNotifier};
use crate::state::{ShopConfig, ShopState};

pub const USER_AGENT: &str =
    "financer-shop/0.1 (personal use; +https://github.com/driver005/financer)";

#[derive(Debug, Clone, Default)]
pub struct NotifierSetup {
    pub ntfy_url: Option<String>,
    pub ntfy_token: Option<String>,
    pub webhook_url: Option<String>,
    pub webhook_secret: Option<String>,
    pub expo_push: bool,
}

#[derive(Debug, Clone)]
pub struct ShopSetup {
    pub database_url: String,
    pub sources: Vec<SourceConfig>,
    pub request_gap: Duration,
    pub notifiers: NotifierSetup,
    pub llm: Option<LlmSettings>,
    /// Crawl and watch all the time (the server) instead of only when asked (the app).
    pub continuous: bool,
    pub batch: usize,
    pub idle: Duration,
}

impl ShopSetup {
    /// The setup of an app with no server: nothing runs unless the person searches.
    pub fn integrated(
        database_url: &str,
        sources: Vec<SourceConfig>,
        llm: Option<LlmSettings>,
    ) -> ShopSetup {
        ShopSetup {
            database_url: database_url.to_string(),
            sources,
            request_gap: Duration::from_secs(3),
            notifiers: NotifierSetup::default(),
            llm,
            continuous: false,
            batch: 25,
            idle: Duration::from_secs(60),
        }
    }

    /// Read `FINANCER_SHOP_*` settings. `default_database` is used when none is given.
    ///
    /// | Variable | Meaning |
    /// |---|---|
    /// | `FINANCER_SHOP_DATABASE_URL` | `sqlite://...` or `postgres://...` |
    /// | `FINANCER_SHOP_SOURCES` | path of a JSON file of sources (see docs/SHOP.md) |
    /// | `FINANCER_SHOP_SOURCES_JSON` | the same, inline |
    /// | `FINANCER_SHOP_CRAWL` | `false` turns the continuous crawl off (default on) |
    /// | `FINANCER_SHOP_REQUEST_GAP_SECS` | pause between requests to one host (default 3) |
    /// | `FINANCER_SHOP_BATCH`, `FINANCER_SHOP_IDLE_SECS` | pages per round, wait when idle |
    /// | `FINANCER_SHOP_NTFY_URL`, `_NTFY_TOKEN` | push deals through ntfy |
    /// | `FINANCER_SHOP_WEBHOOK_URL`, `_WEBHOOK_SECRET` | post deals as JSON |
    /// | `FINANCER_SHOP_EXPO_PUSH` | `true` pushes to the app's registered devices |
    /// | `FINANCER_ANTHROPIC_API_KEY`, `FINANCER_OPENAI_API_KEY`, `FINANCER_LLM_PROVIDER` | model for pages without structured data |
    pub fn from_lookup(
        get: &dyn Fn(&str) -> Option<String>,
        default_database: &str,
    ) -> Result<ShopSetup, String> {
        let var = |k: &str| {
            get(k)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let flag =
            |k: &str, default: bool| match var(k).as_deref().map(str::to_lowercase).as_deref() {
                None => Ok(default),
                Some("1" | "true" | "yes" | "on") => Ok(true),
                Some("0" | "false" | "no" | "off") => Ok(false),
                Some(other) => Err(format!("{k}: {other:?} is not true or false")),
            };
        let number = |k: &str, default: u64| match var(k) {
            None => Ok(default),
            Some(v) => v
                .parse::<u64>()
                .map_err(|_| format!("{k}: {v:?} is not a number")),
        };
        let sources_json = match (
            var("FINANCER_SHOP_SOURCES_JSON"),
            var("FINANCER_SHOP_SOURCES"),
        ) {
            (Some(json), _) => Some(json),
            (None, Some(path)) => Some(
                std::fs::read_to_string(&path)
                    .map_err(|e| format!("FINANCER_SHOP_SOURCES {path}: {e}"))?,
            ),
            (None, None) => None,
        };
        let sources = match sources_json {
            Some(json) => parse_sources(&json)?,
            None => Vec::new(),
        };
        let llm = {
            let provider = match var("FINANCER_LLM_PROVIDER").as_deref() {
                Some("openai") => Some(Provider::OpenAi),
                Some("claude") => Some(Provider::Claude),
                Some(other) => {
                    return Err(format!(
                        "FINANCER_LLM_PROVIDER: {other:?} is not claude or openai"
                    ))
                }
                None => None,
            };
            let claude = var("FINANCER_ANTHROPIC_API_KEY");
            let openai = var("FINANCER_OPENAI_API_KEY");
            match (provider, claude, openai) {
                (Some(Provider::OpenAi) | None, None, Some(key)) => Some((Provider::OpenAi, key)),
                (Some(Provider::Claude) | None, Some(key), _) => Some((Provider::Claude, key)),
                (Some(Provider::OpenAi), Some(_), Some(key)) => Some((Provider::OpenAi, key)),
                _ => None,
            }
            .map(|(provider, api_key)| LlmSettings {
                provider,
                model: String::new(),
                api_key,
                base_url: None,
            })
        };
        Ok(ShopSetup {
            database_url: var("FINANCER_SHOP_DATABASE_URL")
                .unwrap_or_else(|| default_database.to_string()),
            sources,
            request_gap: Duration::from_secs(number("FINANCER_SHOP_REQUEST_GAP_SECS", 3)?),
            notifiers: NotifierSetup {
                ntfy_url: var("FINANCER_SHOP_NTFY_URL"),
                ntfy_token: var("FINANCER_SHOP_NTFY_TOKEN"),
                webhook_url: var("FINANCER_SHOP_WEBHOOK_URL"),
                webhook_secret: var("FINANCER_SHOP_WEBHOOK_SECRET"),
                expo_push: flag("FINANCER_SHOP_EXPO_PUSH", false)?,
            },
            llm,
            continuous: flag("FINANCER_SHOP_CRAWL", true)?,
            batch: number("FINANCER_SHOP_BATCH", 25)?.clamp(1, 500) as usize,
            idle: Duration::from_secs(number("FINANCER_SHOP_IDLE_SECS", 60)?.max(5)),
        })
    }

    /// Open the store named by `database_url`.
    pub async fn open_store(&self) -> Result<ShopStore, String> {
        ShopStore::connect(&self.database_url)
            .await
            .map_err(|e| format!("cannot open the shopping database: {e}"))
    }

    /// Build the service. `http` replaces the polite web client (tests).
    pub async fn start(
        &self,
        store: ShopStore,
        http: Option<Arc<dyn Http>>,
    ) -> Result<ShopState, String> {
        let registry = Arc::new(RwLock::new(
            store.registry().await.map_err(|e| e.to_string())?,
        ));
        let http: Arc<dyn Http> = match http {
            Some(h) => h,
            None => {
                let inner = ReqwestHttp::new(USER_AGENT).map_err(|e| e.to_string())?;
                Arc::new(PoliteHttp::new(inner, "financer", self.request_gap))
            }
        };
        let mut crawler = Crawler::new(http, registry.clone(), self.sources.clone());
        if let Some(settings) = &self.llm {
            match ProviderFactory::create(settings) {
                Ok(provider) => {
                    crawler = crawler.with_reader(Arc::new(LlmReader::new(Arc::from(provider))))
                }
                Err(e) => tracing::warn!("the model for reading pages is not usable: {e}"),
            }
        }
        let mut notifiers: Vec<Arc<dyn Notifier>> = Vec::new();
        let n = &self.notifiers;
        if n.ntfy_url.is_some() || n.webhook_url.is_some() || n.expo_push {
            let poster: Arc<dyn Poster> = Arc::new(ReqwestPoster::new()?);
            if let Some(url) = &n.ntfy_url {
                notifiers.push(Arc::new(NtfyNotifier {
                    poster: poster.clone(),
                    topic_url: url.clone(),
                    token: n.ntfy_token.clone(),
                }));
            }
            if let Some(url) = &n.webhook_url {
                notifiers.push(Arc::new(WebhookNotifier {
                    poster: poster.clone(),
                    url: url.clone(),
                    secret: n.webhook_secret.clone(),
                }));
            }
            if n.expo_push {
                notifiers.push(Arc::new(ExpoNotifier {
                    poster,
                    endpoint: ExpoNotifier::ENDPOINT.into(),
                }));
            }
        }
        let config = ShopConfig {
            continuous: self.continuous,
            llm: self.llm.is_some(),
            ..ShopConfig::default()
        };
        Ok(ShopState::new(store, registry, crawler, config).with_notifiers(notifiers))
    }

    /// Start the continuous crawl when this setup asks for it. Returns whether it started.
    pub fn spawn_background(&self, state: &ShopState) -> bool {
        if !self.continuous {
            return false;
        }
        tokio::spawn(state.clone().run_forever(self.batch, self.idle));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn nothing_set_means_defaults_and_a_continuous_server() {
        let s = ShopSetup::from_lookup(&env(&[]), "sqlite://x.db?mode=rwc").unwrap();
        assert_eq!(s.database_url, "sqlite://x.db?mode=rwc");
        assert!(s.sources.is_empty() && s.continuous && s.llm.is_none());
        assert_eq!(
            (s.batch, s.request_gap, s.idle),
            (25, Duration::from_secs(3), Duration::from_secs(60))
        );
        assert!(!s.notifiers.expo_push);
    }

    #[test]
    fn everything_can_be_set_and_mistakes_are_named() {
        let s = ShopSetup::from_lookup(
            &env(&[
                ("FINANCER_SHOP_DATABASE_URL", "postgres://u@h/db"),
                (
                    "FINANCER_SHOP_SOURCES_JSON",
                    r#"[{"name":"a","urls":["https://a.test/p"]}]"#,
                ),
                ("FINANCER_SHOP_CRAWL", "off"),
                ("FINANCER_SHOP_BATCH", "9999"),
                ("FINANCER_SHOP_NTFY_URL", "https://ntfy.sh/deals"),
                ("FINANCER_SHOP_EXPO_PUSH", "true"),
                ("FINANCER_ANTHROPIC_API_KEY", "sk-test"),
            ]),
            "unused",
        )
        .unwrap();
        assert_eq!(s.database_url, "postgres://u@h/db");
        assert_eq!(s.sources.len(), 1);
        assert!(!s.continuous);
        assert_eq!(s.batch, 500);
        assert_eq!(
            s.notifiers.ntfy_url.as_deref(),
            Some("https://ntfy.sh/deals")
        );
        assert!(s.notifiers.expo_push);
        assert_eq!(s.llm.as_ref().map(|l| l.provider), Some(Provider::Claude));

        assert!(
            ShopSetup::from_lookup(&env(&[("FINANCER_SHOP_CRAWL", "maybe")]), "d")
                .unwrap_err()
                .contains("true or false")
        );
        assert!(
            ShopSetup::from_lookup(&env(&[("FINANCER_SHOP_BATCH", "x")]), "d")
                .unwrap_err()
                .contains("not a number")
        );
        assert!(ShopSetup::from_lookup(
            &env(&[("FINANCER_SHOP_SOURCES_JSON", "[{\"name\":\"\"}]")]),
            "d"
        )
        .is_err());
        assert!(ShopSetup::from_lookup(
            &env(&[("FINANCER_SHOP_SOURCES", "/no/such/file.json")]),
            "d"
        )
        .unwrap_err()
        .contains("/no/such/file.json"));
    }

    #[tokio::test]
    async fn a_service_is_built_from_a_setup_with_the_configured_notifiers() {
        let mut setup = ShopSetup::integrated("sqlite::memory:", vec![], None);
        setup.notifiers.ntfy_url = Some("https://ntfy.sh/x".into());
        let store = setup.open_store().await.unwrap();
        let state = setup.start(store, None).await.unwrap();
        assert!(!state.config.continuous);
        assert_eq!(state.notifiers.len(), 1);
        assert!(
            !setup.spawn_background(&state),
            "an integrated setup never crawls on its own"
        );
    }
}
