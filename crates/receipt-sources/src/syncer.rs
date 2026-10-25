//! Runs the enabled sources on their schedules and reports how each is doing.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use financer_core::{StoreAlias, StoreMatcher};
use financer_store::Store;
use serde::{Deserialize, Serialize};

use crate::config::{ReceiptSourcesConfig, SourceKind};
use crate::email::{EmailCursor, EmailSync};
use crate::error::SyncError;
use crate::folder::FolderSync;
use crate::lidl::{Connection, Endpoints, LidlClient, LidlHttp, LidlPlus, ReqwestLidlHttp};
use crate::mail::{ImapConnector, MailboxConnector};
use crate::matching::Linker;
use crate::secret::SecretBox;
use crate::summary::RunSummary;

const USER_AGENT: &str =
    "financer-personal/0.1 (personal use; +https://github.com/driver005/financer)";
/// Pause between requests to Lidl's ticket API.
const LIDL_REQUEST_GAP: Duration = Duration::from_secs(1);
/// How often the scheduler looks at the clock.
const TICK: Duration = Duration::from_secs(15);
/// Wait after start-up before the first run, so the server is up and answering first.
const STARTUP_DELAY: Duration = Duration::from_secs(20);

/// Reads an environment variable.
pub type EnvLookup = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Everything outside the process, replaceable in tests.
#[derive(Clone)]
pub struct SyncDeps {
    pub connector: Arc<dyn MailboxConnector>,
    pub lidl_http: Arc<dyn LidlHttp>,
    /// Reads environment variables (the mailbox password lives in one).
    pub env: EnvLookup,
    pub lidl_gap: Duration,
}

impl SyncDeps {
    /// Real IMAP, real HTTPS, the process environment.
    pub fn live() -> Result<Self, String> {
        Ok(SyncDeps {
            connector: Arc::new(ImapConnector::new()),
            lidl_http: Arc::new(ReqwestLidlHttp::new(USER_AGENT).map_err(|e| e.to_string())?),
            env: Arc::new(|k| std::env::var(k).ok().filter(|v| !v.is_empty())),
            lidl_gap: LIDL_REQUEST_GAP,
        })
    }
}

/// How a source is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceHealth {
    /// Not configured or switched off.
    Disabled,
    /// Enabled, has not run yet.
    Waiting,
    Running,
    Ok,
    Error,
    /// Lidl Plus is on but nobody signed in yet.
    NotConnected,
    /// Lidl Plus needs a new sign-in.
    NeedsSignin,
}

/// One source as the app shows it. Contains no secrets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceStatus {
    pub kind: SourceKind,
    pub configured: bool,
    pub enabled: bool,
    pub health: SourceHealth,
    /// Unix seconds.
    pub last_run: Option<i64>,
    pub last_success: Option<i64>,
    pub next_run: Option<i64>,
    pub last_error: Option<String>,
    /// Receipts the last run stored.
    pub last_imported: u32,
    /// Receipts from this source in the database.
    pub imported_total: u64,
    /// Remarks from the last run (why a file or mail was skipped).
    pub notes: Vec<String>,
    /// Where it reads from, e.g. `imap.example.org:993 INBOX`.
    pub detail: Option<String>,
}

/// What `sync_now` did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncReport {
    pub sources: Vec<SourceStatus>,
    pub imported: u32,
    /// Receipts newly linked to a bank transaction.
    pub linked: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum SyncNowError {
    #[error("a sync is already running")]
    Busy,
    #[error("{0}")]
    Failed(#[from] SyncError),
}

/// Saved per source after each run.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct RunRecord {
    last_run: Option<i64>,
    last_success: Option<i64>,
    last_error: Option<String>,
    last_imported: u32,
    notes: Vec<String>,
}

fn now_unix() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

pub struct ReceiptSyncer {
    store: Store,
    cfg: ReceiptSourcesConfig,
    deps: SyncDeps,
    lidl: Option<LidlPlus>,
    /// Decides which chain a booking belongs to (the Stores screen's table plus your spellings).
    matcher: StoreMatcher,
    running: Mutex<HashSet<SourceKind>>,
    run_lock: tokio::sync::Mutex<()>,
}

impl ReceiptSyncer {
    pub fn new(
        store: Store,
        cfg: ReceiptSourcesConfig,
        deps: SyncDeps,
        server_secret: &str,
        store_aliases: &[StoreAlias],
    ) -> Result<Arc<Self>, String> {
        if let Some(p) = cfg.problems().first() {
            return Err(p.clone());
        }
        let lidl = if cfg.lidl_plus.enabled {
            let secrets = SecretBox::new(server_secret)
                .map_err(|e| format!("cannot keep the Lidl Plus sign-in safe: {e}"))?;
            let client = LidlClient::new(
                deps.lidl_http.clone(),
                Endpoints::from_config(&cfg.lidl_plus),
                deps.lidl_gap,
            );
            Some(LidlPlus::new(store.clone(), secrets, client))
        } else {
            None
        };
        Ok(Arc::new(ReceiptSyncer {
            store,
            cfg,
            deps,
            lidl,
            matcher: StoreMatcher::with_aliases(store_aliases),
            running: Mutex::new(HashSet::new()),
            run_lock: tokio::sync::Mutex::new(()),
        }))
    }

    /// The server's usual setup: real IMAP and HTTPS. `Ok(None)` when no source is enabled.
    /// The Lidl token is encrypted with `FINANCER_SECRET_KEY`, or else a key derived from the
    /// API token.
    pub fn live(
        store: Store,
        cfg: ReceiptSourcesConfig,
        api_token: &str,
        store_aliases: &[StoreAlias],
    ) -> Result<Option<Arc<Self>>, String> {
        if !cfg.any_enabled() {
            return Ok(None);
        }
        let secret = std::env::var("FINANCER_SECRET_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| api_token.to_string());
        Self::new(store, cfg, SyncDeps::live()?, &secret, store_aliases).map(Some)
    }

    /// The on-phone backend's setup: real HTTPS, and no environment variable for the key. `secret`
    /// is kept by the app in the phone's secure storage and must stay the same between starts,
    /// or a stored Lidl sign-in can no longer be opened. `Ok(None)` when no source is enabled.
    pub fn for_device(
        store: Store,
        cfg: ReceiptSourcesConfig,
        secret: &str,
        store_aliases: &[StoreAlias],
    ) -> Result<Option<Arc<Self>>, String> {
        if !cfg.any_enabled() {
            return Ok(None);
        }
        Self::new(store, cfg, SyncDeps::live()?, secret, store_aliases).map(Some)
    }

    pub fn config(&self) -> &ReceiptSourcesConfig {
        &self.cfg
    }

    /// The Lidl Plus source, when switched on.
    pub fn lidl(&self) -> Option<&LidlPlus> {
        self.lidl.as_ref()
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    fn enabled(&self, kind: SourceKind) -> bool {
        match kind {
            SourceKind::Email => self.cfg.email.as_ref().is_some_and(|e| e.enabled),
            SourceKind::LidlPlus => self.cfg.lidl_plus.enabled,
            SourceKind::Folder => self.cfg.folder.as_ref().is_some_and(|f| f.enabled),
        }
    }

    fn interval(&self, kind: SourceKind) -> Option<Duration> {
        match kind {
            SourceKind::Email => self.cfg.email.as_ref().map(|e| e.poll_interval()),
            SourceKind::LidlPlus => Some(self.cfg.lidl_plus.poll_interval()),
            SourceKind::Folder => self.cfg.folder.as_ref().map(|f| f.poll_interval()),
        }
    }

    fn detail(&self, kind: SourceKind) -> Option<String> {
        match kind {
            SourceKind::Email => self
                .cfg
                .email
                .as_ref()
                .map(|e| format!("{}:{} {}", e.host, e.port, e.folder)),
            SourceKind::LidlPlus => Some(format!(
                "{}-{}",
                self.cfg.lidl_plus.language.to_lowercase(),
                self.cfg.lidl_plus.country.to_uppercase()
            )),
            SourceKind::Folder => self
                .cfg
                .folder
                .as_ref()
                .map(|f| f.path.display().to_string()),
        }
    }

    fn record_key(kind: SourceKind) -> String {
        format!("run:{}", kind.key())
    }

    async fn record(&self, kind: SourceKind) -> Result<RunRecord, SyncError> {
        Ok(self
            .store
            .source_state(&Self::record_key(kind))
            .await?
            .and_then(|s| serde_json::from_str(&s.state).ok())
            .unwrap_or_default())
    }

    async fn save_record(&self, kind: SourceKind, rec: &RunRecord) -> Result<(), SyncError> {
        self.store
            .put_source_state(
                &Self::record_key(kind),
                &serde_json::to_string(rec).unwrap_or_else(|_| "{}".into()),
            )
            .await?;
        Ok(())
    }

    /// How every source is doing.
    pub async fn statuses(&self) -> Result<Vec<SourceStatus>, SyncError> {
        let mut out = Vec::new();
        for kind in SourceKind::ALL {
            out.push(self.status(kind).await?);
        }
        Ok(out)
    }

    async fn status(&self, kind: SourceKind) -> Result<SourceStatus, SyncError> {
        let configured = match kind {
            SourceKind::Email => self.cfg.email.is_some(),
            SourceKind::LidlPlus => true,
            SourceKind::Folder => self.cfg.folder.is_some(),
        };
        let enabled = self.enabled(kind);
        let rec = self.record(kind).await?;
        let imported_total = self.store.count_receipts_from(kind.key()).await?;
        let connection = match (&self.lidl, kind) {
            (Some(l), SourceKind::LidlPlus) => Some(l.connection().await?),
            _ => None,
        };
        let running = self.running.lock().unwrap().contains(&kind);
        let health = if !enabled {
            SourceHealth::Disabled
        } else if running {
            SourceHealth::Running
        } else {
            match connection {
                Some(Connection::Never) => SourceHealth::NotConnected,
                Some(Connection::NeedsSignin) => SourceHealth::NeedsSignin,
                _ if rec.last_run.is_none() => SourceHealth::Waiting,
                _ if rec.last_error.is_some() => SourceHealth::Error,
                _ => SourceHealth::Ok,
            }
        };
        let runnable = enabled
            && !matches!(
                health,
                SourceHealth::NotConnected | SourceHealth::NeedsSignin
            );
        let next_run = match (runnable, self.interval(kind)) {
            (true, Some(iv)) => Some(
                rec.last_run
                    .map_or_else(now_unix, |t| t + iv.as_secs() as i64),
            ),
            _ => None,
        };
        Ok(SourceStatus {
            kind,
            configured,
            enabled,
            health,
            last_run: rec.last_run,
            last_success: rec.last_success,
            next_run,
            last_error: rec.last_error,
            last_imported: rec.last_imported,
            imported_total,
            notes: rec.notes,
            detail: self.detail(kind),
        })
    }

    /// Run one source now (the caller holds `run_lock`). Failures are recorded, not returned.
    async fn run_source(&self, kind: SourceKind) -> Result<u32, SyncError> {
        self.running.lock().unwrap().insert(kind);
        let result = self.execute(kind).await;
        self.running.lock().unwrap().remove(&kind);

        let mut rec = self.record(kind).await?;
        let now = now_unix();
        rec.last_run = Some(now);
        let imported = match result {
            Ok((summary, error)) => {
                rec.last_imported = summary.imported;
                rec.notes = summary.notes;
                match error {
                    None => {
                        rec.last_success = Some(now);
                        rec.last_error = None;
                    }
                    Some(e) => rec.last_error = Some(e),
                }
                summary.imported
            }
            Err(e) => {
                rec.last_imported = 0;
                rec.last_error = Some(e.to_user_text());
                0
            }
        };
        self.save_record(kind, &rec).await?;
        Ok(imported)
    }

    /// The source's own work. A partial result (progress plus an error) is `Ok((summary, Some(error)))`.
    async fn execute(&self, kind: SourceKind) -> Result<(RunSummary, Option<String>), SyncError> {
        match kind {
            SourceKind::Email => {
                let cfg = self
                    .cfg
                    .email
                    .as_ref()
                    .ok_or_else(|| SyncError::other("the mailbox is not configured"))?;
                // a password typed into the app wins; else the variable named by password_env
                let typed = cfg.password.clone().filter(|p| !p.trim().is_empty());
                let password = match typed {
                    Some(p) => p,
                    None => (self.deps.env)(&cfg.password_env).ok_or_else(|| {
                        SyncError::other(format!(
                            "the mailbox password is not set: enter it in the app (Settings > Server), or set the environment variable {}",
                            cfg.password_env
                        ))
                    })?,
                };
                let cursor: EmailCursor = self
                    .store
                    .source_state(kind.key())
                    .await?
                    .and_then(|s| serde_json::from_str(&s.state).ok())
                    .unwrap_or_default();
                let run = EmailSync::run(
                    &self.store,
                    cfg,
                    &password,
                    self.deps.connector.as_ref(),
                    cursor,
                )
                .await;
                self.store
                    .put_source_state(
                        kind.key(),
                        &serde_json::to_string(&run.cursor).unwrap_or_else(|_| "{}".into()),
                    )
                    .await?;
                // whatever the server said, the password does not leave this function
                let error = run.error.map(|e| e.replace(&password, "***"));
                Ok((run.summary, error))
            }
            SourceKind::Folder => {
                let cfg = self
                    .cfg
                    .folder
                    .as_ref()
                    .ok_or_else(|| SyncError::other("the folder is not configured"))?;
                Ok((FolderSync::run(&self.store, cfg).await?, None))
            }
            SourceKind::LidlPlus => {
                let lidl = self
                    .lidl
                    .as_ref()
                    .ok_or_else(|| SyncError::other("Lidl Plus is not enabled"))?;
                Ok((lidl.sync().await?, None))
            }
        }
    }

    /// Run the enabled sources (or just `only`) right now. Refused while another run is going.
    pub async fn sync_now(&self, only: Option<SourceKind>) -> Result<SyncReport, SyncNowError> {
        let _guard = self.run_lock.try_lock().map_err(|_| SyncNowError::Busy)?;
        let mut imported = 0;
        for kind in SourceKind::ALL {
            if only.is_some_and(|o| o != kind) || !self.enabled(kind) {
                continue;
            }
            if kind == SourceKind::LidlPlus {
                // nothing to do until someone has signed in
                if let Some(l) = &self.lidl {
                    if l.connection().await? != Connection::Connected {
                        continue;
                    }
                }
            }
            imported += self.run_source(kind).await?;
        }
        let linked = Linker::run(&self.store, &self.matcher).await?;
        Ok(SyncReport {
            sources: self.statuses().await?,
            imported,
            linked,
        })
    }

    /// Sources whose next run is due at `now` (unix seconds).
    pub async fn due(&self, now: i64) -> Result<Vec<SourceKind>, SyncError> {
        let mut out = Vec::new();
        for kind in SourceKind::ALL {
            if !self.enabled(kind) {
                continue;
            }
            if kind == SourceKind::LidlPlus {
                match &self.lidl {
                    Some(l) if l.connection().await? == Connection::Connected => {}
                    _ => continue,
                }
            }
            let Some(iv) = self.interval(kind) else {
                continue;
            };
            let last = self.record(kind).await?.last_run;
            if last.is_none_or(|t| now - t >= iv.as_secs() as i64) {
                out.push(kind);
            }
        }
        Ok(out)
    }

    /// The scheduler: wakes every few seconds and runs whatever is due. Never returns.
    pub async fn run(self: Arc<Self>) {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            match self.due(now_unix()).await {
                Ok(due) if !due.is_empty() => {
                    let guard = self.run_lock.lock().await;
                    let mut imported = 0;
                    for kind in due {
                        match self.run_source(kind).await {
                            Ok(n) => imported += n,
                            Err(e) => tracing::warn!("receipt source {}: {e}", kind.key()),
                        }
                    }
                    if let Err(e) = Linker::run(&self.store, &self.matcher).await {
                        tracing::warn!("linking receipts to transactions failed: {e}");
                    }
                    drop(guard);
                    if imported > 0 {
                        tracing::info!("{imported} new receipt(s) imported");
                    }
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("receipt sources: {e}"),
            }
            tokio::time::sleep(TICK).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EmailConfig, FolderConfig, LidlPlusConfig, OnDone};
    use crate::lidl::Method;
    use crate::testing::{
        lidl_fixtures as fx, rewe_ebon_pdf, FakeLidlHttp, FakeMailbox, MailBuilder,
    };

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    struct Rig {
        syncer: Arc<ReceiptSyncer>,
        store: Store,
        mailbox: FakeMailbox,
        http: Arc<FakeLidlHttp>,
        dir: std::path::PathBuf,
    }

    async fn rig(password: Option<&'static str>) -> Rig {
        let dir = std::env::temp_dir().join(format!(
            "financer-syncer-{}-{}",
            std::process::id(),
            &crate::text::sha256_hex(format!("{:?}", std::time::Instant::now()).as_bytes())[..8]
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mailbox = FakeMailbox::new(5);
        let http = Arc::new(FakeLidlHttp::default());
        let cfg = ReceiptSourcesConfig {
            email: Some(EmailConfig {
                enabled: true,
                host: "imap.example.org".into(),
                port: 993,
                username: "me@example.org".into(),
                password_env: "TEST_IMAP_PASSWORD".into(),
                password: None,
                folder: "INBOX".into(),
                poll_minutes: 30,
                mark_seen: false,
                max_age_days: 90,
                senders: Vec::new(),
            }),
            lidl_plus: LidlPlusConfig {
                enabled: true,
                poll_hours: 6,
                ..Default::default()
            },
            folder: Some(FolderConfig {
                enabled: true,
                path: dir.clone(),
                poll_seconds: 60,
                on_done: OnDone::Keep,
            }),
        };
        let deps = SyncDeps {
            connector: Arc::new(mailbox.clone()),
            lidl_http: http.clone(),
            env: Arc::new(move |k| {
                (k == "TEST_IMAP_PASSWORD")
                    .then(|| password.map(String::from))
                    .flatten()
            }),
            lidl_gap: Duration::ZERO,
        };
        let syncer = ReceiptSyncer::new(store.clone(), cfg, deps, SECRET, &[]).unwrap();
        Rig {
            syncer,
            store,
            mailbox,
            http,
            dir,
        }
    }

    fn ebon_mail() -> Vec<u8> {
        MailBuilder::new("ebon@mailing.rewe.de", "Dein REWE eBon")
            .attach("ebon.pdf", "application/pdf", rewe_ebon_pdf())
            .build()
    }

    fn by_kind(s: &[SourceStatus], k: SourceKind) -> &SourceStatus {
        s.iter().find(|x| x.kind == k).unwrap()
    }

    #[tokio::test]
    async fn fresh_syncer_lists_every_source_with_its_state() {
        let r = rig(Some("pw")).await;
        let s = r.syncer.statuses().await.unwrap();
        assert_eq!(s.len(), 3);
        assert_eq!(by_kind(&s, SourceKind::Email).health, SourceHealth::Waiting);
        assert_eq!(
            by_kind(&s, SourceKind::Folder).health,
            SourceHealth::Waiting
        );
        assert_eq!(
            by_kind(&s, SourceKind::LidlPlus).health,
            SourceHealth::NotConnected
        );
        assert_eq!(
            by_kind(&s, SourceKind::Email).detail.as_deref(),
            Some("imap.example.org:993 INBOX")
        );
        // nothing that looks like a credential is part of a status
        let text = format!("{s:?}");
        assert!(
            !text.contains("me@example.org") && !text.contains("pw\""),
            "{text}"
        );
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn sync_now_runs_sources_links_and_reports() {
        let r = rig(Some("pw")).await;
        r.mailbox.deliver(ebon_mail(), 2);
        // a card payment that matches the eBon
        r.store
            .insert_new_transactions(&[financer_core::Transaction {
                booking_date: time::macros::date!(2026 - 03 - 03),
                amount: financer_core::Money::from_cents(-784),
                counterparty: "REWE SAGT DANKE".into(),
                purpose: "Kartenzahlung".into(),
                counterparty_iban: None,
                category: None,
            }])
            .await
            .unwrap();

        let report = r.syncer.sync_now(None).await.unwrap();
        assert_eq!(report.imported, 1);
        assert_eq!(report.linked, 1);
        let email = by_kind(&report.sources, SourceKind::Email);
        assert_eq!(
            (email.health, email.last_imported, email.imported_total),
            (SourceHealth::Ok, 1, 1)
        );
        assert!(
            email.last_run.is_some() && email.last_success.is_some() && email.next_run.is_some()
        );
        assert_eq!(
            by_kind(&report.sources, SourceKind::Folder).health,
            SourceHealth::Ok
        );
        // Lidl is on but not signed in: skipped, not an error
        assert_eq!(
            by_kind(&report.sources, SourceKind::LidlPlus).health,
            SourceHealth::NotConnected
        );
        assert_eq!(r.http.requests().len(), 0);
        assert!(r.store.receipt_metas().await.unwrap()[0]
            .transaction_id
            .is_some());

        // a second run finds nothing new
        let again = r.syncer.sync_now(None).await.unwrap();
        assert_eq!((again.imported, again.linked), (0, 0));
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn one_source_can_be_run_alone() {
        let r = rig(Some("pw")).await;
        r.mailbox.deliver(ebon_mail(), 2);
        let report = r.syncer.sync_now(Some(SourceKind::Folder)).await.unwrap();
        assert_eq!(report.imported, 0);
        assert_eq!(
            by_kind(&report.sources, SourceKind::Email).health,
            SourceHealth::Waiting
        );
        assert_eq!(r.mailbox.connects(), 0);
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn failures_are_recorded_without_secrets_and_clear_on_success() {
        let r = rig(None).await; // password variable not set
        let report = r.syncer.sync_now(Some(SourceKind::Email)).await.unwrap();
        let email = by_kind(&report.sources, SourceKind::Email);
        assert_eq!(email.health, SourceHealth::Error);
        assert!(email
            .last_error
            .as_deref()
            .unwrap()
            .contains("TEST_IMAP_PASSWORD"));
        std::fs::remove_dir_all(r.dir).ok();

        let r = rig(Some("s3cret-pw")).await;
        r.mailbox.fail_next_connect("connection refused");
        let report = r.syncer.sync_now(Some(SourceKind::Email)).await.unwrap();
        let email = by_kind(&report.sources, SourceKind::Email);
        assert_eq!(email.health, SourceHealth::Error);
        assert!(!email.last_error.as_deref().unwrap().contains("s3cret-pw"));
        // the next run succeeds and the error disappears
        r.mailbox.deliver(ebon_mail(), 1);
        let report = r.syncer.sync_now(Some(SourceKind::Email)).await.unwrap();
        let email = by_kind(&report.sources, SourceKind::Email);
        assert_eq!(
            (email.health, email.last_error.clone()),
            (SourceHealth::Ok, None)
        );
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn the_mail_cursor_survives_a_restart() {
        let r = rig(Some("pw")).await;
        r.mailbox.deliver(ebon_mail(), 2);
        r.syncer.sync_now(Some(SourceKind::Email)).await.unwrap();
        // a new syncer over the same database does not download the mail again
        let again = ReceiptSyncer::new(
            r.store.clone(),
            r.syncer.config().clone(),
            SyncDeps {
                connector: Arc::new(r.mailbox.clone()),
                lidl_http: r.http.clone(),
                env: Arc::new(|_| Some("pw".into())),
                lidl_gap: Duration::ZERO,
            },
            SECRET,
            &[],
        )
        .unwrap();
        again.sync_now(Some(SourceKind::Email)).await.unwrap();
        assert_eq!(r.mailbox.fetched(), vec![1]);
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn lidl_runs_once_signed_in_and_the_schedule_honours_poll_hours() {
        let r = rig(Some("pw")).await;
        let lidl = r.syncer.lidl().unwrap();
        r.http
            .respond(Method::Post, "/connect/token", 200, fx::TOKEN);
        let start = lidl.start().await.unwrap();
        lidl.finish(&start.state, "com.lidlplus.app://callback?code=C")
            .await
            .unwrap();
        r.http
            .respond(Method::Get, "pageNumber=1", 200, fx::TICKETS_PAGE_1);
        r.http
            .respond(Method::Get, "pageNumber=2", 200, fx::TICKETS_PAGE_2);
        r.http.respond(
            Method::Get,
            "/tickets/FIXTURE-TICKET-0001",
            200,
            fx::TICKET_1,
        );
        r.http.respond(
            Method::Get,
            "/tickets/FIXTURE-TICKET-0002",
            200,
            fx::TICKET_2,
        );
        r.http.respond(
            Method::Get,
            "/tickets/FIXTURE-TICKET-0003",
            200,
            fx::TICKET_3,
        );

        let now = now_unix();
        assert!(
            r.syncer
                .due(now)
                .await
                .unwrap()
                .contains(&SourceKind::LidlPlus),
            "never ran: due"
        );
        let report = r.syncer.sync_now(Some(SourceKind::LidlPlus)).await.unwrap();
        let l = by_kind(&report.sources, SourceKind::LidlPlus);
        assert_eq!(
            (l.health, l.last_imported, l.imported_total),
            (SourceHealth::Ok, 2, 2)
        );

        let due = |at: i64| {
            let s = r.syncer.clone();
            async move { s.due(at).await.unwrap() }
        };
        assert!(
            !due(now + 5 * 3600).await.contains(&SourceKind::LidlPlus),
            "poll_hours is 6"
        );
        assert!(due(now + 6 * 3600 + 5)
            .await
            .contains(&SourceKind::LidlPlus));
        // email polls every 30 minutes, the folder every minute
        assert!(!due(now + 20 * 60).await.contains(&SourceKind::LidlPlus));
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn due_skips_disabled_and_unconnected_sources() {
        let r = rig(Some("pw")).await;
        let due = r.syncer.due(now_unix()).await.unwrap();
        assert!(due.contains(&SourceKind::Email) && due.contains(&SourceKind::Folder));
        assert!(!due.contains(&SourceKind::LidlPlus), "not signed in");

        let off = ReceiptSyncer::new(
            r.store.clone(),
            ReceiptSourcesConfig::default(),
            SyncDeps {
                connector: Arc::new(r.mailbox.clone()),
                lidl_http: r.http.clone(),
                env: Arc::new(|_| None),
                lidl_gap: Duration::ZERO,
            },
            SECRET,
            &[],
        )
        .unwrap();
        assert!(off.due(now_unix()).await.unwrap().is_empty());
        assert!(off.lidl().is_none());
        let s = off.statuses().await.unwrap();
        assert!(s
            .iter()
            .all(|x| x.health == SourceHealth::Disabled && !x.enabled));
        let report = off.sync_now(None).await.unwrap();
        assert_eq!(report.imported, 0);
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[tokio::test]
    async fn a_second_sync_while_one_runs_is_refused() {
        let r = rig(Some("pw")).await;
        let _held = r.syncer.run_lock.lock().await;
        assert!(matches!(
            r.syncer.sync_now(None).await,
            Err(SyncNowError::Busy)
        ));
        std::fs::remove_dir_all(r.dir).ok();
    }

    #[test]
    fn bad_setups_are_refused_at_construction() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let store = Store::connect("sqlite::memory:").await.unwrap();
            let deps = SyncDeps {
                connector: Arc::new(FakeMailbox::new(1)),
                lidl_http: Arc::new(FakeLidlHttp::default()),
                env: Arc::new(|_| None),
                lidl_gap: Duration::ZERO,
            };
            let lidl_on = ReceiptSourcesConfig {
                lidl_plus: LidlPlusConfig {
                    enabled: true,
                    ..Default::default()
                },
                ..Default::default()
            };
            let e = ReceiptSyncer::new(store.clone(), lidl_on, deps.clone(), "short", &[])
                .err()
                .unwrap();
            assert!(e.contains("too short"), "{e}");
            let bad = ReceiptSourcesConfig {
                folder: Some(FolderConfig {
                    enabled: true,
                    path: std::path::PathBuf::new(),
                    poll_seconds: 60,
                    on_done: OnDone::Keep,
                }),
                ..Default::default()
            };
            assert!(ReceiptSyncer::new(store, bad, deps, SECRET, &[]).is_err());
        });
    }
}
