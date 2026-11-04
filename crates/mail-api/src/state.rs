//! The running mail client: the store, the configured mailbox and the two connectors (IMAP in,
//! SMTP out). Everything that talks to a server sits behind a trait so tests use fakes.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use financer_mail_core::{Me, Template, TemplateKind};
use financer_mail_store::MailStore;
use financer_receipt_sources::mail::{ImapConnector, MailboxConnector};

use crate::config::MailConfig;
use crate::smtp::{Sender, SmtpSender};

pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub use financer_mail_core::wire::SyncReport;

#[derive(Clone)]
pub struct MailState {
    pub(crate) store: MailStore,
    pub(crate) config: Option<Arc<MailConfig>>,
    pub(crate) connector: Arc<dyn MailboxConnector>,
    pub(crate) sender: Arc<dyn Sender>,
    pub(crate) clock: Clock,
    pub(crate) sync_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) last_sync: Arc<RwLock<Option<SyncReport>>>,
}

pub(crate) const LAST_SYNC_KEY: &str = "last_sync";
const SEEDED_KEY: &str = "templates_seeded";

fn system_clock() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

impl MailState {
    /// The client for a configured mailbox (real IMAP and SMTP), or without one: the templates and
    /// the calendar still work.
    pub fn new(store: MailStore, config: Option<MailConfig>) -> MailState {
        let sender: Arc<dyn Sender> = match &config {
            Some(c) => Arc::new(SmtpSender::new(c)),
            None => Arc::new(NoSender),
        };
        MailState {
            store,
            config: config.map(Arc::new),
            connector: Arc::new(ImapConnector::new()),
            sender,
            clock: Arc::new(system_clock),
            sync_gate: Arc::new(tokio::sync::Mutex::new(())),
            last_sync: Arc::new(RwLock::new(None)),
        }
    }

    pub fn with_connector(mut self, connector: Arc<dyn MailboxConnector>) -> MailState {
        self.connector = connector;
        self
    }

    pub fn with_sender(mut self, sender: Arc<dyn Sender>) -> MailState {
        self.sender = sender;
        self
    }

    pub fn with_clock(mut self, clock: Clock) -> MailState {
        self.clock = clock;
        self
    }

    pub fn store(&self) -> &MailStore {
        &self.store
    }

    pub fn configured(&self) -> bool {
        self.config.is_some()
    }

    pub(crate) fn now(&self) -> i64 {
        (self.clock)()
    }

    /// Your own addresses, for telling which messages are yours.
    pub(crate) fn me(&self) -> Me {
        Me::new(
            self.config
                .as_ref()
                .map(|c| c.my_addresses())
                .unwrap_or_default(),
        )
    }

    pub(crate) fn zone(&self) -> financer_mail_core::Zone {
        self.config
            .as_ref()
            .map(|c| c.zone)
            .unwrap_or(financer_mail_core::Zone::BERLIN)
    }

    pub(crate) fn remember_sync(&self, report: &SyncReport) {
        if let Ok(mut slot) = self.last_sync.write() {
            *slot = Some(report.clone());
        }
    }

    /// The last sync of this run, or else the one saved before the restart.
    pub(crate) async fn last_sync(&self) -> Option<SyncReport> {
        if let Some(r) = self.last_sync.read().ok().and_then(|s| s.clone()) {
            return Some(r);
        }
        let saved = self.store.get_setting(LAST_SYNC_KEY).await.ok().flatten()?;
        serde_json::from_str(&saved).ok()
    }

    /// The first time, a few templates to start from, so the screen is not empty and the idea is
    /// visible: a friendly and a formal greeting, and closings. Never again once any exist or once
    /// the person deleted them all.
    pub async fn ensure_default_templates(
        &self,
    ) -> Result<(), financer_mail_store::MailStoreError> {
        if self.store.get_setting(SEEDED_KEY).await?.is_some() {
            return Ok(());
        }
        if self.store.template_count().await? == 0 {
            let t = |kind, name: &str, text: &str, default| Template {
                id: 0,
                kind,
                name: name.into(),
                text: text.into(),
                fallback: None,
                audience: vec![],
                is_default: default,
            };
            let mut friendly = t(
                TemplateKind::Greeting,
                "Friendly",
                "Hallo {first_name},",
                true,
            );
            friendly.fallback = Some("Hallo,".into());
            let mut formal = t(
                TemplateKind::Greeting,
                "Formal",
                "Sehr geehrte Damen und Herren,",
                false,
            );
            formal.fallback = None;
            for tpl in [
                friendly,
                t(
                    TemplateKind::Greeting,
                    "Dear",
                    "Lieber {first_name},",
                    false,
                ),
                formal,
                t(TemplateKind::Closing, "Short", "VG\n{my_first_name}", true),
                t(
                    TemplateKind::Closing,
                    "Warm",
                    "Viele Grüße\n{my_first_name}",
                    false,
                ),
                t(
                    TemplateKind::Closing,
                    "Formal",
                    "Mit freundlichen Grüßen\n{me}",
                    false,
                ),
            ] {
                self.store.create_template(&tpl).await?;
            }
        }
        self.store.set_setting(SEEDED_KEY, "1").await
    }

    /// Syncs now and then, for as long as the server runs. Returns `None` when there is no mailbox
    /// or the interval is 0 (then only the app's own "sync" asks).
    pub fn spawn_poller(&self) -> Option<tokio::task::JoinHandle<()>> {
        let cfg = self.config.as_ref()?;
        if cfg.poll_minutes == 0 {
            return None;
        }
        let state = self.clone();
        let every = Duration::from_secs(cfg.poll_minutes * 60);
        Some(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(15)).await;
            loop {
                let more = match state.sync_now().await {
                    Ok(report) => {
                        if let Some(e) = &report.error {
                            tracing::warn!("mail sync: {e}");
                        } else if report.stored > 0 || report.events > 0 {
                            tracing::info!(
                                stored = report.stored,
                                events = report.events,
                                "mail sync"
                            );
                        }
                        report.more && report.error.is_none()
                    }
                    Err(e) => {
                        tracing::warn!("mail sync: {e}");
                        false
                    }
                };
                if !more {
                    tokio::time::sleep(every).await;
                }
            }
        }))
    }
}

/// Used when no mailbox is configured.
struct NoSender;

#[async_trait::async_trait]
impl Sender for NoSender {
    async fn send(
        &self,
        _from: &str,
        _to: &[String],
        _raw: Vec<u8>,
    ) -> Result<(), crate::smtp::SendError> {
        Err(crate::smtp::SendError::Connect(
            "no mailbox is configured".into(),
        ))
    }
}
